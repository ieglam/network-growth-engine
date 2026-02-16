import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import {
  searchLinkedIn,
  type SearchCriteria,
  type ScrapedProspect,
  type SearchProgress,
} from '../services/linkedinSearchScraper.js';
import { importProspects } from '../services/prospectImporter.js';
import { generateDailyQueue } from '../services/queueGenerationService.js';
import { processAllPriorityScores } from '../services/priorityScoringService.js';

// In-memory store for search progress and results (single-user app)
let currentSearchProgress: SearchProgress | null = null;
let lastSearchResults: ScrapedProspect[] = [];

interface SearchHistoryEntry {
  id: string;
  criteria: SearchCriteria;
  resultCount: number;
  importedCount: number;
  searchedAt: string;
}

const searchHistory: SearchHistoryEntry[] = [];

const searchCriteriaSchema = z.object({
  jobTitles: z.array(z.string()).optional(),
  companies: z.array(z.string()).optional(),
  industries: z.array(z.string()).optional(),
  keywords: z.string().optional(),
  location: z.string().optional(),
  maxResults: z.number().min(1).max(100).optional(),
});

const importBodySchema = z.object({
  prospects: z.array(
    z.object({
      firstName: z.string(),
      lastName: z.string(),
      fullName: z.string(),
      title: z.string().nullable(),
      company: z.string().nullable(),
      linkedinUrl: z.string(),
      headline: z.string().nullable(),
      location: z.string().nullable(),
      mutualConnectionsCount: z.number(),
    })
  ),
});

export async function linkedinSearchRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions
) {
  // POST /api/linkedin/search — Trigger a search
  fastify.post('/linkedin/search', async (request, reply) => {
    const bodyResult = searchCriteriaSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: bodyResult.error.message },
      });
    }

    const criteria = bodyResult.data as SearchCriteria;

    // Check if a search is already running
    if (
      currentSearchProgress &&
      currentSearchProgress.status !== 'complete' &&
      currentSearchProgress.status !== 'error'
    ) {
      return reply.status(409).send({
        success: false,
        error: { code: 'SEARCH_IN_PROGRESS', message: 'A search is already running' },
      });
    }

    // Reset progress
    currentSearchProgress = {
      status: 'initializing',
      currentPage: 0,
      totalFound: 0,
      scraped: 0,
      message: 'Starting search...',
    };

    // Run search in background (don't await)
    searchLinkedIn(criteria, (progress) => {
      currentSearchProgress = progress;
    })
      .then((results) => {
        lastSearchResults = results;
        const historyId = crypto.randomUUID();
        searchHistory.unshift({
          id: historyId,
          criteria,
          resultCount: results.length,
          importedCount: 0,
          searchedAt: new Date().toISOString(),
        });
        // Keep only last 50 entries
        if (searchHistory.length > 50) searchHistory.length = 50;
      })
      .catch((error) => {
        currentSearchProgress = {
          status: 'error',
          currentPage: 0,
          totalFound: 0,
          scraped: 0,
          message: error instanceof Error ? error.message : 'Search failed',
        };
      });

    return {
      success: true,
      data: { message: 'Search started', progress: currentSearchProgress },
    };
  });

  // GET /api/linkedin/search/progress — Get current search progress
  fastify.get('/linkedin/search/progress', async () => {
    return {
      success: true,
      data: {
        progress: currentSearchProgress,
        results: currentSearchProgress?.status === 'complete' ? lastSearchResults : [],
        resultCount: lastSearchResults.length,
      },
    };
  });

  // GET /api/linkedin/search/results — Get last search results
  fastify.get('/linkedin/search/results', async () => {
    return {
      success: true,
      data: {
        results: lastSearchResults,
        count: lastSearchResults.length,
      },
    };
  });

  // GET /api/linkedin/search/history — Get past searches
  fastify.get('/linkedin/search/history', async () => {
    return {
      success: true,
      data: searchHistory,
    };
  });

  // POST /api/linkedin/search/import — Import selected prospects
  fastify.post('/linkedin/search/import', async (request, reply) => {
    const bodyResult = importBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: bodyResult.error.message },
      });
    }

    const result = await importProspects(bodyResult.data.prospects);

    // Update the latest search history entry with import count
    if (searchHistory.length > 0) {
      searchHistory[0].importedCount += result.imported;
    }

    return {
      success: true,
      data: result,
    };
  });

  // GET /api/linkedin/search/debug — Take screenshot and dump HTML for debugging selectors
  fastify.get('/linkedin/search/debug', async (request) => {
    const { keywords } = request.query as { keywords?: string };
    const { newPage, launchBrowser } = await import('../services/linkedinBrowserService.js');
    await launchBrowser();
    const page = await newPage();
    try {
      const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords || 'compliance officer')}&origin=GLOBAL_SEARCH_HEADER`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);

      const url = page.url();
      const title = await page.title();

      // Take screenshot
      const { resolve } = await import('path');
      const screenshotPath = resolve(process.cwd(), '.linkedin', 'debug-screenshot.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });

      // Get key HTML snippets
      const bodyClasses = await page.evaluate(() => document.body.className);
      const resultContainers = await page.evaluate(() => {
        const selectors = [
          '.search-results-container',
          '.reusable-search__result-container',
          'li.reusable-search__result-container',
          '[data-chameleon-result-urn]',
          '.search-reusables__no-results',
          '.artdeco-empty-state',
          'ul.reusable-search__entity-result-list',
          'div.search-results-container',
          'main',
        ];
        const found: Record<string, number> = {};
        for (const sel of selectors) {
          found[sel] = document.querySelectorAll(sel).length;
        }
        return found;
      });

      // Get structure around profile links
      const profileLinkInfo = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/in/"]'));
        return links.slice(0, 5).map((link) => {
          // Walk up to find the result container
          let container = link.parentElement;
          for (let i = 0; i < 10 && container; i++) {
            if (container.tagName === 'LI' || (container.dataset && container.dataset.viewName))
              break;
            container = container.parentElement;
          }
          return {
            href: link.getAttribute('href'),
            linkText: link.textContent?.trim()?.substring(0, 100),
            linkClasses: link.className.substring(0, 200),
            linkAriaLabel: link.getAttribute('aria-label'),
            containerTag: container?.tagName,
            containerClasses: container?.className?.substring(0, 200),
            containerDataAttrs: container ? Object.keys(container.dataset) : [],
            containerInnerText: container?.innerText?.substring(0, 300),
          };
        });
      });

      const mainHTML = await page.evaluate(() => {
        const main = document.querySelector('main');
        if (!main) return 'no <main> found';
        return main.innerHTML.substring(0, 3000);
      });

      return {
        success: true,
        data: {
          url,
          title,
          bodyClasses,
          resultContainers,
          screenshotPath,
          profileLinkInfo,
          mainHTMLSnippet: mainHTML,
        },
      };
    } finally {
      await page.close();
    }
  });

  // POST /api/queue/regenerate — Regenerate daily queue on demand
  fastify.post('/queue/regenerate', async () => {
    // Recalculate priority scores so category weights are reflected
    const scoring = await processAllPriorityScores();

    // Clear today's pending/approved items so regeneration starts fresh
    const today = new Date();
    const queueDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    await prisma.queueItem.deleteMany({
      where: {
        queueDate,
        status: { in: ['pending', 'approved'] },
      },
    });

    const result = await generateDailyQueue({ queueDate });
    return {
      success: true,
      data: { ...result, scoring },
    };
  });
}
