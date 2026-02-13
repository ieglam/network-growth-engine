import { Worker, Queue } from 'bullmq';
import { generateDailyQueue } from '../services/queueGenerationService.js';

const QUEUE_NAME = 'daily-queue-generation';

export function createDailyQueueQueue(redisUrl: string) {
  const queue = new Queue(QUEUE_NAME, {
    connection: { url: redisUrl },
  });

  return queue;
}

export function createDailyQueueWorker(redisUrl: string) {
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      console.log(`[${QUEUE_NAME}] Generating daily queue...`);
      const start = Date.now();

      const result = await generateDailyQueue();

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(
        `[${QUEUE_NAME}] Done in ${elapsed}s — ` +
          `${result.connectionRequests} requests, ${result.followUps} follow-ups, ` +
          `${result.reEngagements} re-engagements, ${result.carriedOver} carried over ` +
          `(${result.flaggedForEditing} flagged for editing)`
      );

      return result;
    },
    {
      connection: { url: redisUrl },
      concurrency: 1,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[${QUEUE_NAME}] Job ${job?.id} failed:`, err);
  });

  return worker;
}

/**
 * Schedule daily queue generation.
 * Default: 7 AM. Pass hour to override.
 */
export async function scheduleDailyQueue(queue: Queue, hour: number = 7) {
  await queue.upsertJobScheduler(
    'daily-queue',
    { pattern: `0 ${hour} * * *` },
    { name: 'generate-queue' }
  );

  console.log(`[${QUEUE_NAME}] Scheduled daily at ${hour}:00 AM`);
}
