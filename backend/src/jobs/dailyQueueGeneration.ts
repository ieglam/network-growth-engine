import { Worker, Queue } from 'bullmq';
import { generateDailyQueue } from '../services/queueGenerationService.js';
import { sendQueueReadyEmail } from '../services/emailService.js';
import { prisma } from '../lib/prisma.js';

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

      // Send email notification if items were generated
      if (result.total > 0) {
        const today = new Date();
        const queueDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

        const queueItems = await prisma.queueItem.findMany({
          where: { queueDate },
          include: {
            contact: { select: { firstName: true, lastName: true, company: true, linkedinUrl: true } },
          },
          orderBy: { createdAt: 'asc' },
        });

        const emailItems = queueItems.map((item) => ({
          contactName: `${item.contact.firstName} ${item.contact.lastName}`,
          company: item.contact.company,
          actionType: item.actionType,
          linkedinUrl: item.contact.linkedinUrl,
        }));

        await sendQueueReadyEmail(emailItems, queueDate);
      }

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
 * Default: 7 AM Moscow time. Pass hour to override.
 */
export async function scheduleDailyQueue(queue: Queue, hour: number = 7) {
  await queue.upsertJobScheduler(
    'daily-queue',
    { pattern: `0 ${hour} * * *`, tz: 'America/Mexico_City' },
    { name: 'generate-queue' }
  );

  console.log(`[${QUEUE_NAME}] Scheduled daily at ${hour}:00 AM America/Mexico_City`);
}
