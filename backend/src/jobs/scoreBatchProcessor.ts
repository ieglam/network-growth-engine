import { Worker, Queue } from 'bullmq';
import { processAllContactScores } from '../services/scoringService.js';

const QUEUE_NAME = 'score-batch-processor';

export function createScoreBatchQueue(redisUrl: string) {
  const queue = new Queue(QUEUE_NAME, {
    connection: { url: redisUrl },
  });

  return queue;
}

export function createScoreBatchWorker(redisUrl: string) {
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      console.log(`[${QUEUE_NAME}] Starting relationship score batch...`);
      const start = Date.now();

      const result = await processAllContactScores();

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(
        `[${QUEUE_NAME}] Done in ${elapsed}s — ` +
          `${result.processed} processed, ${result.updated} updated, ${result.transitions} transitions`
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
 * Schedule the score batch to run at 2 AM daily.
 * Call once at worker startup.
 */
export async function scheduleScoreBatch(queue: Queue) {
  await queue.upsertJobScheduler(
    'nightly-score-batch',
    { pattern: '0 2 * * *' },
    { name: 'score-batch' }
  );

  console.log(`[${QUEUE_NAME}] Scheduled nightly at 2:00 AM`);
}
