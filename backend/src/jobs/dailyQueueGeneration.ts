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
      console.log(`[${QUEUE_NAME}] Step 1/3: Generating daily queue...`);
      const start = Date.now();

      const result = await generateDailyQueue();

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(
        `[${QUEUE_NAME}] Step 2/3: Generation complete in ${elapsed}s — ` +
          `${result.connectionRequests} requests, ${result.reEngagements} re-engagements ` +
          `(${result.flaggedForEditing} flagged for editing), total=${result.total}`
      );

      // Send email notification with only the freshly generated items
      const today = new Date();
      const queueDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

      const queueItems = await prisma.queueItem.findMany({
        where: { queueDate, status: 'pending' },
        include: {
          contact: { select: { firstName: true, lastName: true, company: true, linkedinUrl: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      console.log(`[${QUEUE_NAME}] Step 3/3: Found ${queueItems.length} pending items for email`);

      if (queueItems.length > 0) {
        const emailItems = queueItems.map((item) => ({
          contactName: `${item.contact.firstName} ${item.contact.lastName}`,
          company: item.contact.company,
          actionType: item.actionType,
          linkedinUrl: item.contact.linkedinUrl,
        }));

        const sent = await sendQueueReadyEmail(emailItems, queueDate);
        console.log(`[${QUEUE_NAME}] Email ${sent ? 'sent' : 'FAILED'} with ${emailItems.length} items`);
      } else {
        console.log(`[${QUEUE_NAME}] No pending items, skipping email`);
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
 * @param time - HH:MM format, defaults to "07:00"
 */
export async function scheduleDailyQueue(queue: Queue, time: string = '07:00') {
  const [hour, minute] = time.split(':').map(Number);
  await queue.upsertJobScheduler(
    'daily-queue',
    { pattern: `${minute} ${hour} * * *`, tz: 'America/Mexico_City' },
    { name: 'generate-queue' }
  );

  console.log(`[${QUEUE_NAME}] Scheduled daily at ${time} America/Mexico_City`);
}
