import 'dotenv/config';
import { config } from '../lib/config.js';
import {
  createDailyQueueQueue,
  createDailyQueueWorker,
  scheduleDailyQueue,
} from '../jobs/dailyQueueGeneration.js';
import {
  createScoreBatchQueue,
  createScoreBatchWorker,
  scheduleScoreBatch,
} from '../jobs/scoreBatchProcessor.js';

async function startWorkers() {
  const redisUrl = config.redisUrl;

  // Daily queue generation (7 AM Moscow)
  const dailyQueueQueue = createDailyQueueQueue(redisUrl);
  createDailyQueueWorker(redisUrl);
  await scheduleDailyQueue(dailyQueueQueue, config.queueGenerationHour);

  // Nightly score batch (2 AM Moscow)
  const scoreBatchQueue = createScoreBatchQueue(redisUrl);
  createScoreBatchWorker(redisUrl);
  await scheduleScoreBatch(scoreBatchQueue);

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║     Network Growth Engine - Workers                       ║
╠═══════════════════════════════════════════════════════════╣
║  Redis: ${redisUrl.padEnd(48)}║
║  Daily queue generation: ${config.queueGenerationHour}:00 AM America/Mexico_City     ║
║  Score batch: 2:00 AM America/Mexico_City                       ║
╚═══════════════════════════════════════════════════════════╝
  `);
}

startWorkers().catch((err) => {
  console.error('Failed to start workers:', err);
  process.exit(1);
});
