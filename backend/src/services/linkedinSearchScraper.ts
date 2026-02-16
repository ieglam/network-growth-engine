import { Page } from 'playwright';
import { newPage, launchBrowser } from './linkedinBrowserService.js';

export interface SearchCriteria {
  jobTitles?: string[];
  companies?: string[];
  industries?: string[];
  keywords?: string;
  location?: string;
  maxResults?: number; // default 100
}

export interface ScrapedProspect {
  firstName: string;
  lastName: string;
  fullName: string;
  title: string | null;
  company: string | null;
  linkedinUrl: string;
  headline: string | null;
  location: string | null;
  mutualConnectionsCount: number;
}

export interface SearchProgress {
  status: 'initializing' | 'searching' | 'scraping' | 'complete' | 'error';
  currentPage: number;
  totalFound: number;
  scraped: number;
  message: string;
}

type ProgressCallback = (progress: SearchProgress) => void;

const MAX_PROFILE_VIEWS_PER_DAY = 50;
const PAGE_DELAY_MIN = 2000;
const PAGE_DELAY_MAX = 5000;
const DEFAULT_MAX_RESULTS = 100;

function randomDelay(): number {
  return PAGE_DELAY_MIN + Math.random() * (PAGE_DELAY_MAX - PAGE_DELAY_MIN);
}

/**
 * Build LinkedIn People Search URL from criteria.
 */
function buildSearchUrl(criteria: SearchCriteria, page: number): string {
  const params = new URLSearchParams();

  if (criteria.keywords) {
    params.set('keywords', criteria.keywords);
  }

  const searchTerms: string[] = [];

  if (criteria.jobTitles && criteria.jobTitles.length > 0) {
    params.set('titleFreeText', criteria.jobTitles.join(' OR '));
  }

  if (criteria.companies && criteria.companies.length > 0) {
    params.set('company', criteria.companies.join(' OR '));
  }

  if (criteria.location) {
    searchTerms.push(criteria.location);
  }

  if (criteria.industries && criteria.industries.length > 0) {
    searchTerms.push(criteria.industries.join(' '));
  }

  if (searchTerms.length > 0 && !criteria.keywords) {
    params.set('keywords', searchTerms.join(' '));
  } else if (searchTerms.length > 0 && criteria.keywords) {
    params.set('keywords', criteria.keywords + ' ' + searchTerms.join(' '));
  }

  if (page > 1) {
    params.set('page', String(page));
  }

  params.set('origin', 'GLOBAL_SEARCH_HEADER');

  return `https://www.linkedin.com/search/results/people/?${params.toString()}`;
}

/**
 * Scrape search results using JavaScript evaluation.
 * LinkedIn's new SDUI uses obfuscated class names, so we extract data
 * by finding profile links and parsing the surrounding container text.
 */
async function scrapeSearchPage(page: Page): Promise<ScrapedProspect[]> {
  // Wait for profile links to appear
  await page.waitForSelector('a[href*="/in/"]', { timeout: 10000 }).catch(() => null);

  // Scroll to load lazy content
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(800);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  // Extract all prospect data via page.evaluate for reliability
  const rawProspects = await page.evaluate(() => {
    const results: Array<{
      linkedinUrl: string;
      containerText: string;
    }> = [];

    // Find all containers that have data-view-name and contain a profile link
    const containers = document.querySelectorAll('div[data-view-name][data-view-tracking-scope]');

    for (const container of containers) {
      const profileLink = container.querySelector('a[href*="/in/"]') as HTMLAnchorElement | null;
      if (!profileLink) continue;

      const href = profileLink.getAttribute('href');
      if (!href) continue;

      const urlMatch = href.match(/\/in\/([^/?]+)/);
      if (!urlMatch) continue;

      const linkedinUrl = `https://www.linkedin.com/in/${urlMatch[1]}/`;
      const containerText = (container as HTMLElement).innerText || '';

      // Skip if already seen (duplicate links in same result)
      if (results.some((r) => r.linkedinUrl === linkedinUrl)) continue;

      results.push({ linkedinUrl, containerText });
    }

    return results;
  });

  const prospects: ScrapedProspect[] = [];

  for (const raw of rawProspects) {
    const prospect = parseContainerText(raw.linkedinUrl, raw.containerText);
    if (prospect) {
      prospects.push(prospect);
    }
  }

  return prospects;
}

/**
 * Parse the innerText of a search result container.
 *
 * Typical patterns observed:
 *   "Katie Makstenieks, MBA · 3rd+\n\nGlobal Chief Compliance Officer, AtomicVest\n\nChicago, Illinois, United States\n\nMessage\n\n..."
 *   "Minakshi Yerra, LLM  · 2nd\n\nChief Compliance Officer, Board Advisor\n\nSan Francisco, California, United States\n\nFollow\n\n..."
 */
function parseContainerText(linkedinUrl: string, text: string): ScrapedProspect | null {
  // Split by double newlines (LinkedIn uses \n\n between sections)
  const lines = text
    .split(/\n\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) return null;

  // Line 0: Name · Degree (e.g. "Katie Makstenieks, MBA · 3rd+")
  const nameLine = lines[0];

  // Remove degree indicator (· 1st, · 2nd, · 3rd+, etc.)
  // LinkedIn uses various unicode chars for the separator; match broadly
  const nameClean = nameLine
    .replace(/\n.*$/s, '') // Remove anything after first newline
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/\s*.{0,3}\s*(1st|2nd|3rd\+?|Out of Network).*$/i, '') // Remove degree + everything after
    .trim();
  if (!nameClean || nameClean === 'LinkedIn Member') return null;

  // Remove suffixes/credentials in the name for first/last parsing
  // but keep them in fullName
  const fullName = nameClean;
  // Strip common suffixes for name parsing: MBA, CPA, JD, LLM, CAMS, PhD, etc.
  const nameForParsing = nameClean
    .replace(
      /,\s*(MBA|CPA|JD|LLM|CAMS|PhD|CFA|CFP|CISSP|PMP|Esq|PE|MD|RN|SHRM-\w+|SPHR|PHR|ACAMS|CFE)\.?$/i,
      ''
    )
    .trim();
  const nameParts = nameForParsing.split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  // Line 1: Title/Headline (e.g. "Global Chief Compliance Officer, AtomicVest")
  const headline = lines[1] || null;

  // Line 2: Location (e.g. "Chicago, Illinois, United States")
  // Location lines typically contain a US state or country name and commas
  let location: string | null = null;
  if (lines[2] && !isActionButton(lines[2])) {
    location = lines[2];
  }

  // Parse title and company from headline
  let title: string | null = null;
  let company: string | null = null;
  if (headline) {
    // Patterns: "Title, Company" or "Title at Company" or "Title | Company"
    const atMatch = headline.match(/^(.+?)\s+at\s+(.+)$/i);
    const commaMatch = headline.match(/^(.+?),\s+(.+)$/);
    const pipeMatch = headline.match(/^(.+?)\s*\|\s*(.+)$/);
    if (atMatch) {
      title = atMatch[1].trim();
      company = atMatch[2].trim();
    } else if (pipeMatch) {
      title = pipeMatch[1].trim();
      company = pipeMatch[2].trim();
    } else if (commaMatch && !looksLikeLocation(commaMatch[2])) {
      title = commaMatch[1].trim();
      company = commaMatch[2].trim();
    } else {
      title = headline;
    }
  }

  // Check for mutual connections in remaining lines
  let mutualConnectionsCount = 0;
  for (const line of lines) {
    const mutualMatch = line.match(/(\d+)\s+mutual/i);
    if (mutualMatch) {
      mutualConnectionsCount = parseInt(mutualMatch[1], 10);
      break;
    }
    // Also match "X and Y are mutual connections"
    const namedMutual = line.match(/are mutual connections?/i);
    if (namedMutual) {
      // Count names: "A and B are mutual connections" = 2
      const andMatch = line.match(/(.+?)\s+are mutual/i);
      if (andMatch) {
        const names = andMatch[1].split(/\s+and\s+/);
        mutualConnectionsCount = names.length;
      }
      break;
    }
  }

  return {
    firstName,
    lastName,
    fullName,
    title,
    company,
    linkedinUrl,
    headline,
    location,
    mutualConnectionsCount,
  };
}

function isActionButton(text: string): boolean {
  const actions = ['message', 'follow', 'connect', 'pending'];
  return actions.includes(text.toLowerCase().trim());
}

function looksLikeLocation(text: string): boolean {
  // Check if text looks like a US state or location rather than company
  const locationPatterns =
    /\b(united states|canada|united kingdom|australia|india|germany|france|california|new york|texas|florida|illinois|ohio|pennsylvania|georgia|michigan|virginia|washington|massachusetts|arizona|colorado|minnesota|wisconsin|oregon|connecticut|utah|nevada|kentucky|louisiana|alabama|oklahoma|iowa|missouri|kansas|arkansas|mississippi|nebraska|idaho|montana|wyoming|dakota|hampshire|vermont|maine|rhode island|delaware|hawaii|alaska)\b/i;
  return locationPatterns.test(text);
}

/**
 * Check if there are more search result pages.
 */
async function hasNextPage(page: Page): Promise<boolean> {
  // Try multiple pagination selectors (old + new LinkedIn)
  const nextVisible = await page.evaluate(() => {
    // New SDUI: look for any button/link with "Next" text
    const buttons = Array.from(document.querySelectorAll('button, a'));
    for (const btn of buttons) {
      const text = btn.textContent?.trim().toLowerCase() || '';
      const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
      if ((text === 'next' || ariaLabel.includes('next')) && !(btn as HTMLButtonElement).disabled) {
        return true;
      }
    }
    // Old pagination
    const oldNext = document.querySelector(
      'button.artdeco-pagination__button--next:not([disabled])'
    );
    return !!oldNext;
  });
  return nextVisible;
}

/**
 * Run a LinkedIn people search and scrape results.
 * READ-ONLY: No connection requests or messages are sent.
 */
export async function searchLinkedIn(
  criteria: SearchCriteria,
  onProgress?: ProgressCallback
): Promise<ScrapedProspect[]> {
  const maxResults = criteria.maxResults ?? DEFAULT_MAX_RESULTS;
  const allProspects: ScrapedProspect[] = [];
  const seenUrls = new Set<string>();
  let currentPage = 1;
  let profileViewCount = 0;

  const report = (progress: Partial<SearchProgress>) => {
    onProgress?.({
      status: 'searching',
      currentPage,
      totalFound: allProspects.length,
      scraped: allProspects.length,
      message: '',
      ...progress,
    });
  };

  report({ status: 'initializing', message: 'Launching browser...' });

  await launchBrowser();

  const page = await newPage();

  try {
    while (allProspects.length < maxResults && profileViewCount < MAX_PROFILE_VIEWS_PER_DAY) {
      report({
        status: 'searching',
        message: `Loading search page ${currentPage}...`,
      });

      const searchUrl = buildSearchUrl(criteria, currentPage);
      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Random delay to be respectful
      await page.waitForTimeout(randomDelay());

      // Check for auth wall
      const currentUrl = page.url();
      if (currentUrl.includes('/authwall') || currentUrl.includes('/login')) {
        report({
          status: 'error',
          message: 'Session expired. Please log in again.',
        });
        throw new Error('LinkedIn session expired during search.');
      }

      // Check for "no results" - use text content since classes are obfuscated
      const noResults = await page.evaluate(() => {
        const text = document.body.innerText || '';
        return text.includes('No results found') || text.includes('0 results');
      });

      if (noResults) {
        report({
          status: 'complete',
          message: `Search complete. No more results found.`,
        });
        break;
      }

      report({
        status: 'scraping',
        message: `Scraping results from page ${currentPage}...`,
      });

      const pageProspects = await scrapeSearchPage(page);
      profileViewCount += pageProspects.length;

      // Deduplicate by LinkedIn URL
      for (const prospect of pageProspects) {
        if (!seenUrls.has(prospect.linkedinUrl) && allProspects.length < maxResults) {
          seenUrls.add(prospect.linkedinUrl);
          allProspects.push(prospect);
        }
      }

      report({
        status: 'searching',
        message: `Found ${allProspects.length} prospects so far...`,
      });

      // Check for next page
      if (pageProspects.length === 0) break;
      const morePages = await hasNextPage(page);
      if (!morePages) break;

      // Navigate to next page
      currentPage++;
      await page.waitForTimeout(randomDelay());
    }

    report({
      status: 'complete',
      message: `Search complete. Found ${allProspects.length} prospects across ${currentPage} pages.`,
    });

    return allProspects;
  } finally {
    await page.close();
  }
}
