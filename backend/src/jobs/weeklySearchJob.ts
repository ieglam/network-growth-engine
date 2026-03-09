import { Worker, Queue } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { searchLinkedIn, type SearchCriteria } from '../services/linkedinSearchScraper.js';
import { importProspects } from '../services/prospectImporter.js';
import { sendSearchResultsEmail } from '../services/emailService.js';

const QUEUE_NAME = 'weekly-search';

export function createWeeklySearchQueue(redisUrl: string) {
  return new Queue(QUEUE_NAME, { connection: { url: redisUrl } });
}

interface SearchRunResult {
  searchName: string;
  found: number;
  imported: number;
  duplicatesSkipped: number;
  errors: number;
}

export function createWeeklySearchWorker(redisUrl: string) {
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      console.log(`[${QUEUE_NAME}] Starting weekly search run...`);

      const scheduledSearches = await prisma.savedSearch.findMany({
        where: { isScheduled: true },
        orderBy: { createdAt: 'asc' },
      });

      if (scheduledSearches.length === 0) {
        console.log(`[${QUEUE_NAME}] No scheduled searches found. Skipping.`);
        return { searches: 0, totalFound: 0, totalImported: 0 };
      }

      console.log(`[${QUEUE_NAME}] Found ${scheduledSearches.length} scheduled searches`);

      const results: SearchRunResult[] = [];

      for (const saved of scheduledSearches) {
        const criteria = saved.criteria as SearchCriteria;
        console.log(`[${QUEUE_NAME}] Running "${saved.name}"...`);

        try {
          const prospects = await searchLinkedIn(criteria, (progress) => {
            if (progress.status === 'complete' || progress.status === 'error') {
              console.log(`[${QUEUE_NAME}]   "${saved.name}": ${progress.message}`);
            }
          });

          console.log(`[${QUEUE_NAME}]   Found ${prospects.length} prospects, importing...`);

          const importResult = await importProspects(prospects);

          await prisma.savedSearch.update({
            where: { id: saved.id },
            data: {
              lastRunAt: new Date(),
              lastRunCount: prospects.length,
              totalImported: { increment: importResult.imported },
            },
          });

          results.push({
            searchName: saved.name,
            found: prospects.length,
            imported: importResult.imported,
            duplicatesSkipped: importResult.duplicatesSkipped,
            errors: importResult.errors,
          });

          console.log(
            `[${QUEUE_NAME}]   "${saved.name}": ${importResult.imported} imported, ` +
            `${importResult.duplicatesSkipped} dupes, ${importResult.errors} errors`
          );

          // Random delay between searches (10-20s) to avoid detection
          if (scheduledSearches.indexOf(saved) < scheduledSearches.length - 1) {
            const delay = 10000 + Math.random() * 10000;
            console.log(`[${QUEUE_NAME}]   Waiting ${(delay / 1000).toFixed(0)}s before next search...`);
            await new Promise((r) => setTimeout(r, delay));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[${QUEUE_NAME}]   "${saved.name}" FAILED: ${msg}`);
          results.push({
            searchName: saved.name,
            found: 0,
            imported: 0,
            duplicatesSkipped: 0,
            errors: 1,
          });
        }
      }

      const totalFound = results.reduce((s, r) => s + r.found, 0);
      const totalImported = results.reduce((s, r) => s + r.imported, 0);

      console.log(
        `[${QUEUE_NAME}] Complete: ${results.length} searches, ` +
        `${totalFound} found, ${totalImported} imported`
      );

      // Send email notification
      if (totalFound > 0) {
        await sendSearchResultsEmail(results).catch((err) => {
          console.error(`[${QUEUE_NAME}] Email failed:`, err);
        });
      }

      return { searches: results.length, totalFound, totalImported, details: results };
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
 * Schedule weekly search — Sundays at 08:00 America/Mexico_City.
 */
export async function scheduleWeeklySearch(queue: Queue) {
  await queue.upsertJobScheduler(
    'weekly-search',
    { pattern: '0 8 * * 0', tz: 'America/Mexico_City' },
    { name: 'run-weekly-searches' }
  );
  console.log(`[${QUEUE_NAME}] Scheduled Sundays at 08:00 America/Mexico_City`);
}
