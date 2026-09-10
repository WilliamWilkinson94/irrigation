const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs/promises');
const path = require('path');

// Import Prisma Client
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// Helper function to get or create the default device configuration
async function getOrCreateDeviceConfig() {
  let device = await prisma.device.findFirst();
  if (!device) {
    device = await prisma.device.create({
      data: {
        name: 'ESP32 Main Controller',
        moistureThreshold: 300,
        solenoidOneActive: false,
        solenoidTwoActive: false,
      },
    });
  }
  return device;
}

// --- REAL-TIME WEBSOCKETS (Telemetry & Hardware Controls) ---
io.on('connection', async (socket) => {
  console.log(`[WebSocket] Connected: ${socket.id}`);

  try {
    // 1. Fetch current device configuration
    const device = await getOrCreateDeviceConfig();

    // 2. Fetch all scheduled/historical watering events from PostgreSQL
    const events = await prisma.wateringEvent.findMany({
      orderBy: { startTime: 'asc' },
    });

    // 3. Fetch past compiled firmware revisions from PostgreSQL
    const revisions = await prisma.firmwareRevision.findMany({
      where: { compileSuccess: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true, versionTag: true, createdAt: true },
    });

    // Push initial persisted state to client
    socket.emit('state:init', {
      threshold: device.moistureThreshold,
      solenoids: {
        solenoidOne: device.solenoidOneActive,
        solenoidTwo: device.solenoidTwoActive,
      },
      schedules: events.map((e) => ({
        id: e.id,
        title: e.title,
        start: e.startTime.toISOString(),
        type: e.eventType === 'SCHEDULED' ? 'future' : 'past',
      })),
      revisions: revisions.map((r) => ({
        id: r.id,
        timestamp: r.createdAt.toISOString(),
        versionTag: r.versionTag,
      })),
    });
  } catch (err) {
    console.error('[WebSocket Init Error]', err);
  }

  // Handle Manual Solenoid Toggle
  socket.on('solenoid:toggle', async ({ target, state }) => {
    try {
      const fieldToUpdate = target === 'solenoidOne' ? 'solenoidOneActive' : 'solenoidTwoActive';
      const device = await getOrCreateDeviceConfig();

      const updatedDevice = await prisma.device.update({
        where: { id: device.id },
        data: { [fieldToUpdate]: state },
      });

      const updatedSolenoids = {
        solenoidOne: updatedDevice.solenoidOneActive,
        solenoidTwo: updatedDevice.solenoidTwoActive,
      };

      console.log(`[Actuator] ${target} set to ${state ? 'ON' : 'OFF'}`);
      io.emit('solenoid:updated', updatedSolenoids);
    } catch (err) {
      console.error('[Database Error]', err);
    }
  });

  // Handle "All Off" Trigger
  socket.on('solenoid:all_off', async () => {
    try {
      const device = await getOrCreateDeviceConfig();

      await prisma.device.update({
        where: { id: device.id },
        data: { solenoidOneActive: false, solenoidTwoActive: false },
      });

      console.log('[Actuator] ALL OFF triggered');
      io.emit('solenoid:updated', { solenoidOne: false, solenoidTwo: false });
    } catch (err) {
      console.error('[Database Error]', err);
    }
  });

  // Handle Threshold Setting
  socket.on('threshold:update', async (newThreshold) => {
    try {
      const device = await getOrCreateDeviceConfig();
      const parsedVal = parseInt(newThreshold, 10);

      const updatedDevice = await prisma.device.update({
        where: { id: device.id },
        data: { moistureThreshold: parsedVal },
      });

      console.log(`[Config] Moisture Threshold updated to: ${updatedDevice.moistureThreshold}`);
      io.emit('threshold:updated', updatedDevice.moistureThreshold);
    } catch (err) {
      console.error('[Database Error]', err);
    }
  });
});

// --- REST ENDPOINTS (Calendar Schedules) ---
app.get('/api/schedules', async (req, res) => {
  try {
    const events = await prisma.wateringEvent.findMany({
      orderBy: { startTime: 'asc' },
    });
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch schedules.' });
  }
});

app.post('/api/schedules', async (req, res) => {
  const { title, startTime, solenoidId } = req.body;

  try {
    const newEvent = await prisma.wateringEvent.create({
      data: {
        title,
        startTime: new Date(startTime),
        solenoidId: solenoidId || 1,
        eventType: 'SCHEDULED',
      },
    });

    const allEvents = await prisma.wateringEvent.findMany({ orderBy: { startTime: 'asc' } });
    io.emit('schedules:updated', allEvents);

    res.status(201).json(newEvent);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create schedule.' });
  }
});

// --- REST ENDPOINTS (Hardware Telemetry Log POST) ---
app.post('/api/telemetry', async (req, res) => {
  const { moistureValue, rawAdc } = req.body;

  try {
    const log = await prisma.telemetryLog.create({
      data: {
        moistureValue: parseInt(moistureValue, 10),
        rawAdc: rawAdc ? parseInt(rawAdc, 10) : null,
      },
    });

    // Broadcast live measurement reading to connected browser dashboards
    io.emit('telemetry:new', {
      moistureValue: log.moistureValue,
      createdAt: log.createdAt,
    });

    res.status(201).json(log);
  } catch (err) {
    res.status(500).json({ error: 'Failed to log telemetry.' });
  }
});

// --- COMPILER & REVISION CONTROL ENGINE (`arduino-cli` + PostgreSQL) ---
app.post('/api/firmware/compile-and-flash', async (req, res) => {
  const { sourceCode } = req.body;

  if (!sourceCode) {
    return res.status(400).json({ error: 'Source code is required.' });
  }

  const buildId = `build_${Date.now()}`;
  const versionTag = `v${Date.now()}`;
  const buildDir = path.join(__dirname, 'tmp', buildId);
  const sketchPath = path.join(buildDir, `${buildId}.ino`);

  try {
    // 1. Save code to disk temporarily for compiler CLI
    await fs.mkdir(buildDir, { recursive: true });
    await fs.writeFile(sketchPath, sourceCode);

    // 2. Execute compilation
    const fqbn = 'esp32:esp32:esp32';
    const compileCmd = `arduino-cli compile --fqbn ${fqbn} "${buildDir}" --output-dir "${buildDir}/build"`;

    console.log(`[Compiler] Compiling snapshot ${versionTag}...`);

    await new Promise((resolve, reject) => {
      exec(compileCmd, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || stdout));
        else resolve(stdout);
      });
    });

    const binaryPath = path.join(buildDir, 'build', `${buildId}.ino.bin`);

    // 3. Save Revision entry directly into PostgreSQL
    const savedRevision = await prisma.firmwareRevision.create({
      data: {
        versionTag,
        rawCode: sourceCode,
        binaryPath,
        compileSuccess: true,
      },
    });

    // 4. Fetch updated revision history and notify clients
    const updatedRevisions = await prisma.firmwareRevision.findMany({
      where: { compileSuccess: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true, versionTag: true, createdAt: true },
    });

    io.emit('revisions:updated', updatedRevisions);

    res.json({
      success: true,
      revisionId: savedRevision.id,
      versionTag: savedRevision.versionTag,
      message: `Firmware snapshot ${versionTag} compiled and saved to PostgreSQL.`,
    });
  } catch (err) {
    console.error(`[Compiler Error]`, err.message);

    // Record failed build attempt in system audit log
    await prisma.systemLog.create({
      data: {
        level: 'ERROR',
        source: 'COMPILER',
        message: err.message,
      },
    });

    res.status(500).json({ error: 'Compilation failed.', details: err.message });
  }
});

// Endpoint to fetch source code for a specific version from PostgreSQL
app.get('/api/firmware/revisions/:id', async (req, res) => {
  try {
    const revision = await prisma.firmwareRevision.findUnique({
      where: { id: req.params.id },
    });

    if (!revision) {
      return res.status(404).json({ error: 'Revision not found' });
    }

    res.json({
      id: revision.id,
      versionTag: revision.versionTag,
      code: revision.rawCode,
      timestamp: revision.createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch revision.' });
  }
});

const PORT = process.env.PORT || 8080;
// Serve compiled frontend static build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}
server.listen(PORT, () => {
  console.log(`[Server] PostgreSQL-backed Node.js server running on http://localhost:${PORT}`);
});
