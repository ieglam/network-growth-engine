import { prisma } from '../lib/prisma.js';
import { ScoringConfigType } from '@prisma/client';
import { checkStatusTransition, checkDemotion } from './statusTransitionService.js';

const RECIPROCAL_TYPES = new Set([
  'linkedin_dm_received',
  'linkedin_comment_received',
  'linkedin_like_received',
  'introduction_received',
  'connection_request_accepted',
]);

interface ScoringConfig {
  weights: Map<string, number>;
  halfLifeDays: number;
  reciprocityThresholdPct: number;
  reciprocityMultiplierMin: number;
  reciprocityMultiplierMax: number;
}

/**
 * Load scoring configuration from the database.
 */
export async function loadScoringConfig(): Promise<ScoringConfig> {
  const [relationshipWeights, generalConfig] = await Promise.all([
    prisma.scoringConfig.findMany({
      where: { configType: ScoringConfigType.relationship_weight },
    }),
    prisma.scoringConfig.findMany({
      where: { configType: ScoringConfigType.general },
    }),
  ]);

  const weights = new Map<string, number>();
  for (const w of relationshipWeights) {
    weights.set(w.key, Number(w.value));
  }

  const general = new Map<string, number>();
  for (const g of generalConfig) {
    general.set(g.key, Number(g.value));
  }

  return {
    weights,
    halfLifeDays: general.get('recency_half_life_days') ?? 90,
    reciprocityThresholdPct: general.get('reciprocity_threshold_pct') ?? 30,
    reciprocityMultiplierMin: general.get('reciprocity_multiplier_min') ?? 1.3,
    reciprocityMultiplierMax: general.get('reciprocity_multiplier_max') ?? 1.5,
  };
}

/**
 * Calculate the recency decay factor for an interaction.
 * Formula: 0.5 ^ (daysSince / halfLifeDays)
 */
export function calculateDecay(daysSince: number, halfLifeDays: number): number {
  if (daysSince <= 0) return 1;
  return Math.pow(0.5, daysSince / halfLifeDays);
}

/**
 * Calculate the reciprocity multiplier.
 */
export function calculateReciprocityMultiplier(
  reciprocalCount: number,
  totalCount: number,
  config: ScoringConfig
): number {
  if (totalCount === 0) return 1.0;

  const reciprocalPct = (reciprocalCount / totalCount) * 100;

  if (reciprocalPct < config.reciprocityThresholdPct) {
    return 1.0;
  }

  // Scale linearly between min and max based on how far above threshold
  const range = config.reciprocityMultiplierMax - config.reciprocityMultiplierMin;
  const maxPct = 100;
  const pctAboveThreshold = reciprocalPct - config.reciprocityThresholdPct;
  const pctRange = maxPct - config.reciprocityThresholdPct;
  const scale = Math.min(pctAboveThreshold / pctRange, 1);

  return config.reciprocityMultiplierMin + range * scale;
}

/**
 * Calculate the relationship score for a single contact.
 * Returns the normalized score (0-100).
 */
export async function calculateContactScore(
  contactId: string,
  config: ScoringConfig,
  now: Date = new Date()
): Promise<number> {
  const interactions = await prisma.interaction.findMany({
    where: { contactId },
    select: { type: true, occurredAt: true },
  });

  if (interactions.length === 0) return 0;

  let rawPoints = 0;
  let reciprocalCount = 0;

  for (const interaction of interactions) {
    const basePoints = config.weights.get(interaction.type) ?? 0;
    const daysSince = (now.getTime() - interaction.occurredAt.getTime()) / (1000 * 60 * 60 * 24);
    const decay = calculateDecay(daysSince, config.halfLifeDays);
    rawPoints += basePoints * decay;

    if (RECIPROCAL_TYPES.has(interaction.type)) {
      reciprocalCount++;
    }
  }

  const reciprocityMultiplier = calculateReciprocityMultiplier(
    reciprocalCount,
    interactions.length,
    config
  );

  rawPoints *= reciprocityMultiplier;

  // Normalize: use a reasonable max as baseline (e.g., ~150 raw points = 100 score)
  // This represents roughly 10 high-value recent interactions
  const maxExpectedPoints = 150;
  const normalized = Math.min(Math.round((rawPoints / maxExpectedPoints) * 100), 100);

  return Math.max(normalized, 0);
}

/**
 * Process all active contacts: recalculate scores, log to history, check transitions.
 * Returns the number of contacts processed.
 */
export async function processAllContactScores(): Promise<{
  processed: number;
  updated: number;
  transitions: number;
}> {
  const config = await loadScoringConfig();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Fetch all non-deleted contacts in batches
  const batchSize = 100;
  let processed = 0;
  let updated = 0;
  let transitions = 0;
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const contacts = await prisma.contact.findMany({
      where: { deletedAt: null },
      select: { id: true, relationshipScore: true },
      take: batchSize,
      skip,
      orderBy: { createdAt: 'asc' },
    });

    if (contacts.length === 0) {
      hasMore = false;
      break;
    }

    for (const contact of contacts) {
      const newScore = await calculateContactScore(contact.id, config, now);
      processed++;

      if (newScore !== contact.relationshipScore) {
        await prisma.contact.update({
          where: { id: contact.id },
          data: { relationshipScore: newScore },
        });
        updated++;
      }

      // Log to score history
      await prisma.scoreHistory.create({
        data: {
          contactId: contact.id,
          scoreType: 'relationship',
          scoreValue: newScore,
          recordedAt: today,
        },
      });

      // Check status transitions
      const promotion = await checkStatusTransition(contact.id);
      if (promotion) transitions++;

      const demotion = await checkDemotion(contact.id);
      if (demotion) transitions++;
    }

    if (contacts.length < batchSize) {
      hasMore = false;
    }
    skip += batchSize;
  }

  return { processed, updated, transitions };
}
