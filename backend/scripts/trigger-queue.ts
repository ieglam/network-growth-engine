import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

import { generateDailyQueue } from '../src/services/queueGenerationService.js';
import { prisma } from '../src/lib/prisma.js';

async function main() {
  console.log('Triggering daily queue generation for today...');
  const result = await generateDailyQueue();
  console.log('Result:', JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
