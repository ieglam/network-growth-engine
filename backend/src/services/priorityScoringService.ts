import { prisma } from '../lib/prisma.js';
import { ScoringConfigType } from '@prisma/client';

interface PriorityWeights {
  relevance: number;
  accessibility: number;
  timing: number;
}

interface SeniorityMultipliers {
  c_suite: number;
  vp: number;
  director: number;
  manager: number;
  ic: number;
}

interface PriorityBreakdown {
  relevance: number;
  accessibility: number;
  timing: number;
  total: number;
}

/**
 * Load priority scoring weights from database.
 */
async function loadPriorityConfig(): Promise<{
  weights: PriorityWeights;
  seniority: SeniorityMultipliers;
}> {
  const [priorityWeights, generalConfig] = await Promise.all([
    prisma.scoringConfig.findMany({
      where: { configType: ScoringConfigType.priority_weight },
    }),
    prisma.scoringConfig.findMany({
      where: { configType: ScoringConfigType.general },
    }),
  ]);

  const pw = new Map<string, number>();
  for (const w of priorityWeights) {
    pw.set(w.key, Number(w.value));
  }

  const gc = new Map<string, number>();
  for (const g of generalConfig) {
    gc.set(g.key, Number(g.value));
  }

  return {
    weights: {
      relevance: pw.get('relevance') ?? 0.5,
      accessibility: pw.get('accessibility') ?? 0.3,
      timing: pw.get('timing') ?? 0.2,
    },
    seniority: {
      c_suite: gc.get('seniority_multiplier_c_suite') ?? 1.5,
      vp: gc.get('seniority_multiplier_vp') ?? 1.5,
      director: gc.get('seniority_multiplier_director') ?? 1.2,
      manager: gc.get('seniority_multiplier_manager') ?? 1.0,
      ic: gc.get('seniority_multiplier_ic') ?? 0.8,
    },
  };
}

/**
 * Calculate relevance score (0-10).
 * Uses highest category weight × seniority multiplier, normalized to 0-10.
 */
export async function calculateRelevance(
  contactId: string,
  seniorityMultipliers: SeniorityMultipliers
): Promise<number> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, deletedAt: null },
    include: {
      categories: { include: { category: true } },
    },
  });

  if (!contact) return 0;

  // Get highest category weight
  let maxCategoryWeight = 0;
  for (const cc of contact.categories) {
    if (cc.category.relevanceWeight > maxCategoryWeight) {
      maxCategoryWeight = cc.category.relevanceWeight;
    }
  }

  // Default to 1 if no categories assigned
  if (maxCategoryWeight === 0) maxCategoryWeight = 1;

  // Get seniority multiplier
  let multiplier = 1.0;
  if (contact.seniority) {
    multiplier = seniorityMultipliers[contact.seniority] ?? 1.0;
  }

  // category_weight (1-10) × multiplier (0.8-1.5), normalized to 0-10
  const raw = maxCategoryWeight * multiplier;
  // Max possible: 10 * 1.5 = 15, normalize to 0-10
  return Math.min(Math.round((raw / 15) * 10 * 10) / 10, 10);
}

/**
 * Calculate accessibility score (0-10, capped).
 * Based on available contact data.
 */
export async function calculateAccessibility(contactId: string): Promise<number> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, deletedAt: null },
  });

  if (!contact) return 0;

  let score = 0;

  // Mutual connections
  if (contact.mutualConnectionsCount >= 5) {
    score += 4;
  } else if (contact.mutualConnectionsCount >= 2) {
    score += 2;
  } else if (contact.mutualConnectionsCount >= 1) {
    score += 1;
  }

  // "Open to Connect" or active LinkedIn presence
  if (contact.hasOpenToConnect || contact.isActiveOnLinkedin) {
    score += 2;
  }

  // Warm intro available: check if any connected contact with score > 60 exists
  // (simplified: check if introductionSource is set)
  if (contact.introductionSource) {
    score += 3;
  }

  return Math.min(score, 10);
}

/**
 * Calculate timing score (additive, uncapped).
 * Currently uses timing trigger config values from the database.
 * Timing data would come from external signals — stubbed for now.
 */
export async function calculateTiming(_contactId: string): Promise<number> {
  // Timing triggers depend on external data sources not yet implemented:
  // - Job changes (LinkedIn profile monitoring)
  // - Recent posts (LinkedIn feed monitoring)
  // - Company funding news (news API)
  // - Shared events, travel, profile views
  //
  // Return 0 until those data sources are integrated.
  return 0;
}

/**
 * Calculate priority score for a single contact.
 */
export async function calculateContactPriority(
  contactId: string
): Promise<PriorityBreakdown | null> {
  const config = await loadPriorityConfig();

  const [relevance, accessibility, timing] = await Promise.all([
    calculateRelevance(contactId, config.seniority),
    calculateAccessibility(contactId),
    calculateTiming(contactId),
  ]);

  const total =
    relevance * config.weights.relevance +
    accessibility * config.weights.accessibility +
    timing * config.weights.timing;

  return {
    relevance,
    accessibility,
    timing,
    total: Math.round(total * 100) / 100,
  };
}

/**
 * Process all target contacts: calculate priority scores and update.
 */
export async function processAllPriorityScores(): Promise<{
  processed: number;
  updated: number;
}> {
  const batchSize = 100;
  let processed = 0;
  let updated = 0;
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const contacts = await prisma.contact.findMany({
      where: { status: 'target', deletedAt: null },
      select: { id: true, priorityScore: true },
      take: batchSize,
      skip,
      orderBy: { createdAt: 'asc' },
    });

    if (contacts.length === 0) {
      hasMore = false;
      break;
    }

    for (const contact of contacts) {
      const result = await calculateContactPriority(contact.id);
      if (!result) continue;

      processed++;

      const currentScore = contact.priorityScore ? Number(contact.priorityScore) : 0;
      if (Math.abs(result.total - currentScore) > 0.01) {
        await prisma.contact.update({
          where: { id: contact.id },
          data: { priorityScore: result.total },
        });
        updated++;
      }
    }

    if (contacts.length < batchSize) {
      hasMore = false;
    }
    skip += batchSize;
  }

  return { processed, updated };
}
