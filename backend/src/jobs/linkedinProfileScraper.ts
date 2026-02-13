import { Worker, Queue, Job } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { newPage } from '../services/linkedinBrowserService.js';
import { canSendRequest, recordRequest } from '../services/linkedinRateLimiter.js';

const QUEUE_NAME = 'linkedin-profile-scrape';

interface ProfileScrapeData {
  contactId: string;
  linkedinUrl: string;
}

interface ScrapedProfile {
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: string;
  location?: string;
  headline?: string;
  mutualConnectionsCount?: number;
  recentPosts?: { text: string; date: string }[];
}

export function createProfileScrapeQueue(redisUrl: string) {
  return new Queue<ProfileScrapeData>(QUEUE_NAME, {
    connection: { url: redisUrl },
  });
}

export function createProfileScrapeWorker(redisUrl: string) {
  const worker = new Worker<ProfileScrapeData>(
    QUEUE_NAME,
    async (job: Job<ProfileScrapeData>) => {
      const { contactId, linkedinUrl } = job.data;
      console.log(`[${QUEUE_NAME}] Scraping profile: ${linkedinUrl}`);

      // Check rate limits
      const rateCheck = await canSendRequest();
      if (!rateCheck.allowed) {
        console.log(`[${QUEUE_NAME}] Rate limited: ${rateCheck.reason}`);
        const delay = rateCheck.waitMs || 60000;
        await job.moveToDelayed(Date.now() + delay);
        return { status: 'delayed', reason: rateCheck.reason };
      }

      const page = await newPage();
      try {
        await page.goto(linkedinUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        await page.waitForTimeout(2000 + Math.random() * 2000);

        // Scrape profile data
        const scraped = await scrapeProfilePage(page);

        await recordRequest();

        // Load existing contact
        const contact = await prisma.contact.findUnique({
          where: { id: contactId },
        });

        if (!contact) {
          console.warn(`[${QUEUE_NAME}] Contact ${contactId} not found`);
          return { status: 'contact_not_found' };
        }

        // Detect changes and create conflicts
        const fieldsToCheck: { field: string; scraped?: string; current?: string | null }[] = [
          { field: 'title', scraped: scraped.title, current: contact.title },
          { field: 'company', scraped: scraped.company, current: contact.company },
          { field: 'location', scraped: scraped.location, current: contact.location },
          { field: 'headline', scraped: scraped.headline, current: contact.headline },
        ];

        const updates: Record<string, unknown> = {};
        const fieldSources = (contact.fieldSources as Record<string, string>) || {};

        for (const { field, scraped: scrapedVal, current } of fieldsToCheck) {
          if (!scrapedVal) continue;

          if (!current) {
            // No existing value — fill it in
            updates[field] = scrapedVal;
            fieldSources[field] = 'linkedin';
          } else if (current.toLowerCase() !== scrapedVal.toLowerCase()) {
            // Value differs — check source hierarchy
            const currentSource = fieldSources[field] || 'linkedin';

            if (currentSource === 'manual' || currentSource === 'email_calendar') {
              // Higher-priority source — create a conflict
              await prisma.dataConflict.create({
                data: {
                  contactId,
                  fieldName: field,
                  manualValue: currentSource === 'manual' ? current : undefined,
                  emailCalendarValue: currentSource === 'email_calendar' ? current : undefined,
                  linkedinValue: scrapedVal,
                },
              });
            } else {
              // Same or lower priority — update directly
              updates[field] = scrapedVal;
              fieldSources[field] = 'linkedin';
            }
          }
        }

        // Update mutual connections count
        if (scraped.mutualConnectionsCount !== undefined) {
          updates.mutualConnectionsCount = scraped.mutualConnectionsCount;
        }

        // Apply updates
        if (Object.keys(updates).length > 0) {
          await prisma.contact.update({
            where: { id: contactId },
            data: {
              ...updates,
              fieldSources,
            },
          });
        }

        console.log(
          `[${QUEUE_NAME}] Scraped ${linkedinUrl} — ${Object.keys(updates).length} fields updated`
        );
        return { status: 'scraped', updatedFields: Object.keys(updates) };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[${QUEUE_NAME}] Failed to scrape ${linkedinUrl}: ${message}`);
        throw error;
      } finally {
        await page.close();
      }
    },
    {
      connection: { url: redisUrl },
      concurrency: 1,
      limiter: {
        max: 1,
        duration: 30000, // At most 1 scrape per 30 seconds
      },
    }
  );

  worker.on('completed', (job) => {
    console.log(`[${QUEUE_NAME}] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[${QUEUE_NAME}] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}

async function scrapeProfilePage(page: import('playwright').Page): Promise<ScrapedProfile> {
  const result: ScrapedProfile = {};

  // Name
  try {
    const nameEl = page.locator('h1.text-heading-xlarge, h1[class*="top-card"]').first();
    const fullName = await nameEl.textContent({ timeout: 5000 }).catch(() => null);
    if (fullName) {
      const parts = fullName.trim().split(/\s+/);
      result.firstName = parts[0];
      result.lastName = parts.slice(1).join(' ');
    }
  } catch {
    // Name not found
  }

  // Headline
  try {
    const headlineEl = page
      .locator('div.text-body-medium, div[class*="top-card-layout__headline"]')
      .first();
    const headline = await headlineEl.textContent({ timeout: 3000 }).catch(() => null);
    if (headline) result.headline = headline.trim();
  } catch {
    // Headline not found
  }

  // Location
  try {
    const locationEl = page.locator('span.text-body-small[class*="top-card"]').first();
    const location = await locationEl.textContent({ timeout: 3000 }).catch(() => null);
    if (location) result.location = location.trim();
  } catch {
    // Location not found
  }

  // Current position (title + company)
  try {
    const experienceSection = page.locator('#experience ~ .pvs-list__outer-container').first();
    const firstRole = experienceSection.locator('.pvs-entity').first();

    const titleEl = firstRole.locator('span[aria-hidden="true"]').first();
    const title = await titleEl.textContent({ timeout: 3000 }).catch(() => null);
    if (title) result.title = title.trim();

    const companyEl = firstRole.locator('span[aria-hidden="true"]').nth(1);
    const company = await companyEl.textContent({ timeout: 3000 }).catch(() => null);
    if (company) {
      // Company name sometimes includes " · Full-time" etc.
      result.company = company.split('·')[0].trim();
    }
  } catch {
    // Experience not found
  }

  // Mutual connections
  try {
    const mutualEl = page
      .locator('a[href*="mutual-connections"], span:has-text("mutual connection")')
      .first();
    const mutualText = await mutualEl.textContent({ timeout: 3000 }).catch(() => null);
    if (mutualText) {
      const match = mutualText.match(/(\d+)/);
      if (match) result.mutualConnectionsCount = parseInt(match[1], 10);
    }
  } catch {
    // Mutual connections not found
  }

  // Recent posts (last 7 days)
  try {
    const activityLink = page.locator('a[href*="/recent-activity/"]').first();
    const activityVisible = await activityLink.isVisible({ timeout: 2000 }).catch(() => false);
    if (activityVisible) {
      // We won't navigate to activity page to avoid extra page loads
      // Just note that activity exists
      result.recentPosts = [];
    }
  } catch {
    // Activity section not found
  }

  return result;
}
