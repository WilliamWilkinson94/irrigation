const { PrismaClient } = require('@prisma/client');

// Instantiate Prisma Client
const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'], // Optional: logs SQL queries to console during dev
});

module.exports = prisma;
