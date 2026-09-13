const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Starting Prisma database seed...');

  // 1. Clear existing test data in correct order to respect foreign key relations
  await prisma.sensorLog?.deleteMany({});
  await prisma.schedule?.deleteMany({});
  await prisma.zone?.deleteMany({});
  await prisma.user?.deleteMany({});

  // 2. Create User Account
  const user = await prisma.user.create({
    data: {
      email: 'admin@irrigation.local',
      name: 'System Admin',
      password: 'hashed_password_placeholder',
    },
  });

  console.log(`Created user: ${user.email}`);

  // 3. Create the Single Pot / Irrigation Zone
  const zone = await prisma.zone.create({
    data: {
      name: 'Nursery Pot A',
      plantType: 'Micro-Irrigation Crop',
      moistureTarget: 60, // Target moisture percentage
      status: 'ACTIVE',
      userId: user.id,
    },
  });

  console.log(`Configured zone: "${zone.name}"`);

  // 4. Generate 24 Hours of Hourly Sensor Logs
  const now = new Date();
  const sensorLogs = [];

  for (let i = 24; i >= 0; i--) {
    const timestamp = new Date(now.getTime() - i * 60 * 60 * 1000);
    
    // Simulates gradual moisture decline over time with slight fluctuations
    const simulatedMoisture = Math.max(30, Math.round(68 - i * 1.1 + Math.sin(i) * 2));

    sensorLogs.push({
      zoneId: zone.id,
      soilMoisture: simulatedMoisture,
      temperatureC: Number((22.0 + Math.sin(i / 3) * 1.8).toFixed(1)),
      humidityPct: Math.round(55 + Math.cos(i / 2) * 4),
      createdAt: timestamp,
    });
  }

  await prisma.sensorLog.createMany({
    data: sensorLogs,
  });

  console.log(`Generated ${sensorLogs.length} historical readings for "${zone.name}".`);

  // 5. Create a Scheduled Watering / Solenoid Dosing Event
  await prisma.schedule.create({
    data: {
      zoneId: zone.id,
      durationSec: 10,
      waterVolumeMl: 200,
      startTime: new Date(now.getTime() + 2 * 60 * 60 * 1000), // Scheduled 2 hours ahead
      enabled: true,
    },
  });

  console.log('Created scheduled watering event.');
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
