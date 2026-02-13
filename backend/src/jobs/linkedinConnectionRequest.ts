import { Worker, Queue, Job } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { newPage } from '../services/linkedinBrowserService.js';
import {
  canSendRequest,
  recordRequest,
  enterCooldown,
  getNextRequestDelay,
} from '../services/linkedinRateLimiter.js';

const QUEUE_NAME = 'linkedin-connection-request';

interface ConnectionRequestData {
  queueItemId: string;
  contactId: string;
  linkedinUrl: string;
  connectionNote: string;
}

export function createConnectionRequestQueue(redisUrl: string) {
  return new Queue<ConnectionRequestData>(QUEUE_NAME, {
    connection: { url: redisUrl },
  });
}

export function createConnectionRequestWorker(redisUrl: string) {
  const worker = new Worker<ConnectionRequestData>(
    QUEUE_NAME,
    async (job: Job<ConnectionRequestData>) => {
      const { queueItemId, contactId, linkedinUrl, connectionNote } = job.data;

      console.log(`[${QUEUE_NAME}] Processing request for ${linkedinUrl}`);

      // 1. Validate connection note length
      if (connectionNote.length > 300) {
        await updateQueueItem(queueItemId, 'failed', 'Connection note exceeds 300 characters');
        throw new Error(`Connection note too long: ${connectionNote.length} chars`);
      }

      // 2. Check rate limits
      const rateCheck = await canSendRequest();
      if (!rateCheck.allowed) {
        console.log(`[${QUEUE_NAME}] Rate limited: ${rateCheck.reason}`);
        // Re-queue with delay
        const delay = rateCheck.waitMs || getNextRequestDelay();
        await job.moveToDelayed(Date.now() + delay);
        return { status: 'delayed', reason: rateCheck.reason };
      }

      // 3. Send the connection request via Playwright
      const page = await newPage();
      try {
        // Navigate to the profile
        await page.goto(linkedinUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        // Wait for page to load
        await page.waitForTimeout(2000 + Math.random() * 2000);

        // Check for soft ban signals
        const pageContent = await page.content();
        if (
          pageContent.includes('your account has been restricted') ||
          pageContent.includes('unusual activity')
        ) {
          console.error(`[${QUEUE_NAME}] Soft ban detected!`);
          await enterCooldown();
          await updateQueueItem(queueItemId, 'failed', 'Soft ban detected — cooldown activated');
          throw new Error('Soft ban detected');
        }

        // Look for the Connect button (various selectors LinkedIn uses)
        const connectButton = page.locator(
          'button:has-text("Connect"), button[aria-label*="connect" i]'
        );

        const connectVisible = await connectButton
          .first()
          .isVisible({ timeout: 5000 })
          .catch(() => false);

        if (!connectVisible) {
          // Check if "Pending" or "Following" — already sent
          const pendingExists = await page
            .locator('button:has-text("Pending"), button:has-text("Following")')
            .first()
            .isVisible({ timeout: 2000 })
            .catch(() => false);

          if (pendingExists) {
            await updateQueueItem(queueItemId, 'executed', 'Request already pending');
            return { status: 'already_pending' };
          }

          // Try "More" dropdown which sometimes contains Connect
          const moreButton = page.locator(
            'button:has-text("More"), button[aria-label="More actions"]'
          );
          const moreVisible = await moreButton
            .first()
            .isVisible({ timeout: 2000 })
            .catch(() => false);

          if (moreVisible) {
            await moreButton.first().click();
            await page.waitForTimeout(1000);

            const connectInMenu = page.locator(
              '[role="menuitem"]:has-text("Connect"), li:has-text("Connect")'
            );
            const menuConnectVisible = await connectInMenu
              .first()
              .isVisible({ timeout: 2000 })
              .catch(() => false);

            if (menuConnectVisible) {
              await connectInMenu.first().click();
              await page.waitForTimeout(1000);
            } else {
              await updateQueueItem(queueItemId, 'failed', 'Connect button not found');
              throw new Error('Connect button not found');
            }
          } else {
            await updateQueueItem(queueItemId, 'failed', 'Connect button not found');
            throw new Error('Connect button not found');
          }
        } else {
          await connectButton.first().click();
          await page.waitForTimeout(1000);
        }

        // Click "Add a note" button in the modal
        const addNoteButton = page.locator('button:has-text("Add a note")');
        const addNoteVisible = await addNoteButton.isVisible({ timeout: 3000 }).catch(() => false);

        if (addNoteVisible) {
          await addNoteButton.click();
          await page.waitForTimeout(500);

          // Type the connection note
          const noteTextarea = page.locator(
            'textarea[name="message"], textarea#custom-message, textarea[placeholder*="note" i]'
          );
          await noteTextarea.fill(connectionNote);
          await page.waitForTimeout(500);
        }

        // Click Send / Send now
        const sendButton = page.locator('button:has-text("Send"), button[aria-label*="Send" i]');
        await sendButton.first().click();

        // Wait for completion
        await page.waitForTimeout(2000);

        // Record the request
        await recordRequest();

        // Update queue item
        await updateQueueItem(queueItemId, 'executed', 'Connection request sent');

        // Update contact status to "requested"
        await prisma.contact.update({
          where: { id: contactId },
          data: { status: 'requested' },
        });

        console.log(`[${QUEUE_NAME}] Successfully sent request to ${linkedinUrl}`);
        return { status: 'sent' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';

        // Detect soft ban patterns
        if (
          message.includes('Soft ban') ||
          message.includes('restricted') ||
          message.includes('unusual')
        ) {
          await enterCooldown();
        }

        console.error(`[${QUEUE_NAME}] Failed: ${message}`);
        throw error;
      } finally {
        await page.close();
      }
    },
    {
      connection: { url: redisUrl },
      concurrency: 1, // Only one request at a time
      limiter: {
        max: 1,
        duration: 120000, // At most 1 job per 2 minutes
      },
    }
  );

  worker.on('completed', (job) => {
    console.log(`[${QUEUE_NAME}] Job ${job.id} completed`);

    // Schedule next job with random delay
    const delay = getNextRequestDelay();
    console.log(`[${QUEUE_NAME}] Next job in ${(delay / 1000).toFixed(0)}s`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[${QUEUE_NAME}] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}

async function updateQueueItem(
  queueItemId: string,
  status: 'executed' | 'failed',
  message: string
): Promise<void> {
  try {
    await prisma.queueItem.update({
      where: { id: queueItemId },
      data: {
        status: status === 'executed' ? 'executed' : 'pending',
        executedAt: status === 'executed' ? new Date() : undefined,
        result: status === 'executed' ? 'success' : 'failed',
        notes: message,
      },
    });
  } catch {
    console.error(`[linkedin-connection-request] Failed to update queue item ${queueItemId}`);
  }
}
