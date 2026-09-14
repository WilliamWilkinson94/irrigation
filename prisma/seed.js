const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Starting Prisma database seed...');

  // 1. Clear existing test data
  await prisma.telemetryLog.deleteMany({});
  await prisma.wateringEvent.deleteMany({});
  await prisma.firmwareRevision.deleteMany({});
  await prisma.systemLog.deleteMany({});
  await prisma.device.deleteMany({});

  // 2. Create Default Device Configuration
  const device = await prisma.device.create({
    data: {
      name: 'ESP32 Irrigation Node',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      moistureThreshold: 300,
      solenoidOneActive: false,
      solenoidTwoActive: false,
      isOnline: true,
    },
  });

  console.log(`Created device: "${device.name}" (${device.id})`);

  // 3. Generate 24 Hours of Telemetry Moisture Logs
  const now = new Date();
  const telemetryLogs = [];

  for (let i = 24; i >= 0; i--) {
    const timestamp = new Date(now.getTime() - i * 60 * 60 * 1000);
    // Simulates raw ADC value change over time (e.g., 200 = wet, 450 = dry)
    const simulatedRawAdc = Math.min(500, Math.round(250 + i * 8 + Math.sin(i) * 5));

    telemetryLogs.push({
      moistureValue: simulatedRawAdc,
      rawAdc: simulatedRawAdc,
      createdAt: timestamp,
    });
  }

  await prisma.telemetryLog.createMany({
    data: telemetryLogs,
  });

  console.log(`Generated ${telemetryLogs.length} historical telemetry readings.`);

  // 4. Create Scheduled Watering Events
  await prisma.wateringEvent.create({
    data: {
      title: 'Automated Morning Irrigation',
      startTime: new Date(now.getTime() + 2 * 60 * 60 * 1000), // 2 hours from now
      endTime: new Date(now.getTime() + 2 * 60 * 60 * 1000 + 10 * 1000), // 10 sec duration
      solenoidId: 1,
      eventType: 'SCHEDULED',
    },
  });

  console.log('Created scheduled watering event.');

  // 5. Create System Audit Log
  await prisma.systemLog.create({
    data: {
      level: 'INFO',
      source: 'SEED_ENGINE',
      message: 'Initial database seed populated successfully.',
    },
  });

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
