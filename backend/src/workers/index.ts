import 'dotenv/config';
import { config } from '../lib/config.js';
import { prisma } from '../lib/prisma.js';
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

  // Read queue_generation_time from DB settings, fall back to env hour / default
  const timeSetting = await prisma.settings.findUnique({
    where: { key: 'queue_generation_time' },
  });
  const queueTime = timeSetting?.value || `${String(config.queueGenerationHour).padStart(2, '0')}:00`;

  // Daily queue generation (Mexico City time)
  const dailyQueueQueue = createDailyQueueQueue(redisUrl);
  const dailyQueueWorker = createDailyQueueWorker(redisUrl);
  await scheduleDailyQueue(dailyQueueQueue, queueTime);

  dailyQueueWorker.on('completed', (job) => {
    console.log(`[daily-queue-generation] Job ${job.id} completed`);
  });

  // Nightly score batch (2 AM Mexico City)
  const scoreBatchQueue = createScoreBatchQueue(redisUrl);
  const scoreBatchWorker = createScoreBatchWorker(redisUrl);
  await scheduleScoreBatch(scoreBatchQueue);

  scoreBatchWorker.on('completed', (job) => {
    console.log(`[score-batch-processor] Job ${job.id} completed`);
  });

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║     Network Growth Engine - Workers                       ║
╠═══════════════════════════════════════════════════════════╣
║  Redis: ${redisUrl.padEnd(48)}║
║  Daily queue generation: ${queueTime} America/Mexico_City            ║
║  Score batch: 2:00 AM America/Mexico_City                       ║
╚═══════════════════════════════════════════════════════════╝
  `);

  // Heartbeat — log every 60s to confirm worker process is alive
  setInterval(() => {
    const now = new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' });
    console.log(`[heartbeat] Worker alive at ${now} (Mexico City)`);
  }, 60_000);

  // Verify scheduler state after registration
  const schedulers = await dailyQueueQueue.getJobSchedulers();
  for (const s of schedulers) {
    console.log(`[scheduler] id=${s.id} pattern=${s.pattern} tz=${s.tz} next=${s.next ? new Date(s.next).toISOString() : 'none'}`);
  }
  const scoreSchedulers = await scoreBatchQueue.getJobSchedulers();
  for (const s of scoreSchedulers) {
    console.log(`[scheduler] id=${s.id} pattern=${s.pattern} tz=${s.tz} next=${s.next ? new Date(s.next).toISOString() : 'none'}`);
  }
}

startWorkers().catch((err) => {
  console.error('Failed to start workers:', err);
  process.exit(1);
});
