import { prisma } from '../lib/prisma.js';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../lib/config.js';

const FETCH_TIMEOUT_MS = 5_000;
const DELAY_BETWEEN_LOOKUPS_MS = 1_000;

// ─── Normalization ──────────────────────────────────────────────────────────

function normalizeCompanyName(name: string): string {
  return name.trim().toLowerCase();
}

// ─── DuckDuckGo Instant Answer API ──────────────────────────────────────────

interface DdgResponse {
  AbstractText?: string;
  Abstract?: string;
  RelatedTopics?: { Text?: string }[];
}

async function fetchDuckDuckGo(company: string): Promise<string | null> {
  const query = encodeURIComponent(`${company} company`);
  const url = `https://api.duckduckgo.com/?q=${query}&format=json&no_html=1&skip_disambig=1`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'NetworkGrowthEngine/1.0 (company-lookup)' },
    });

    if (!res.ok) return null;

    const data = (await res.json()) as DdgResponse;

    // Try AbstractText first (usually Wikipedia summary)
    if (data.AbstractText && data.AbstractText.length > 20) {
      // Truncate to first 2 sentences
      return truncateToSentences(data.AbstractText, 2);
    }

    // Try first RelatedTopic
    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      const first = data.RelatedTopics[0];
      if (first?.Text && first.Text.length > 20) {
        return truncateToSentences(first.Text, 2);
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Haiku knowledge fallback ───────────────────────────────────────────────

async function describeWithHaiku(company: string): Promise<string | null> {
  if (!config.anthropicApiKey) return null;

  try {
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      messages: [
        {
          role: 'user',
          content: `What does the company "${company}" do? Write exactly 1 sentence describing their core business, industry, and products/services. If you don't know or "${company}" is not a real company name, respond with just "unknown".`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return null;

    const result = textBlock.text.trim();
    if (result.toLowerCase().startsWith('unknown') || result.length < 10) return null;
    return truncateToSentences(result, 1);
  } catch {
    return null;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function truncateToSentences(text: string, maxSentences: number): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (!sentences) return text.slice(0, 200);
  return sentences.slice(0, maxSentences).join(' ').trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Look up a single company description. Tries DDG → Google+Haiku → "unknown".
 */
export async function lookupCompanyDescription(company: string): Promise<string> {
  // Skip obvious non-company strings (headlines, taglines, long pipe-separated lists)
  if (company.includes('|') || company.length > 100) {
    return 'unknown';
  }

  // 1. DuckDuckGo instant answer
  const ddgResult = await fetchDuckDuckGo(company);
  if (ddgResult) {
    return ddgResult;
  }

  // 2. Ask Haiku directly (it knows most well-known companies)
  const haikuResult = await describeWithHaiku(company);
  if (haikuResult) {
    return haikuResult;
  }

  return 'unknown';
}

/**
 * Get a company description from cache, or look it up and cache it.
 */
export async function getCompanyDescription(companyName: string): Promise<string> {
  const normalized = normalizeCompanyName(companyName);

  // Check cache
  const cached = await prisma.companyDescription.findUnique({
    where: { companyName: normalized },
  });

  if (cached) return cached.description;

  // Look up
  const description = await lookupCompanyDescription(companyName);

  // Cache result (including "unknown")
  await prisma.companyDescription.upsert({
    where: { companyName: normalized },
    update: { description, source: 'web_search', updatedAt: new Date() },
    create: { companyName: normalized, description, source: 'web_search' },
  });

  return description;
}

/**
 * Bulk-enrich company descriptions for a list of company names.
 * Returns a Map<normalizedName, description>.
 */
export async function enrichCompanyDescriptions(
  companyNames: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const uniqueNormalized = [...new Set(companyNames.map(normalizeCompanyName))];

  // Batch-fetch all cached descriptions
  const cached = await prisma.companyDescription.findMany({
    where: { companyName: { in: uniqueNormalized } },
  });

  for (const entry of cached) {
    result.set(entry.companyName, entry.description);
  }

  // Find which ones need lookup
  const uncached = uniqueNormalized.filter((name) => !result.has(name));

  if (uncached.length > 0) {
    console.log(`[CompanyLookup] ${cached.length} cached, ${uncached.length} to look up`);
  }

  for (const normalized of uncached) {
    try {
      const description = await lookupCompanyDescription(normalized);

      await prisma.companyDescription.upsert({
        where: { companyName: normalized },
        update: { description, source: 'web_search' },
        create: { companyName: normalized, description, source: 'web_search' },
      });

      result.set(normalized, description);
      console.log(
        `[CompanyLookup] "${normalized}" → ${description === 'unknown' ? 'unknown' : description.slice(0, 60) + '...'}`
      );
    } catch (err) {
      console.error(`[CompanyLookup] Failed for "${normalized}":`, err);
      result.set(normalized, 'unknown');
    }

    // Rate limit: wait between lookups
    if (uncached.indexOf(normalized) < uncached.length - 1) {
      await sleep(DELAY_BETWEEN_LOOKUPS_MS);
    }
  }

  return result;
}

export { normalizeCompanyName };
