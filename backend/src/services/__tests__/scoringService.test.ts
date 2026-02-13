import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { ScoringConfigType } from '@prisma/client';
import {
  calculateDecay,
  calculateReciprocityMultiplier,
  calculateContactScore,
  loadScoringConfig,
  processAllContactScores,
} from '../scoringService.js';

beforeAll(async () => {
  // Ensure scoring config exists (seed data)
  const weights = [
    { key: 'meeting_1on1_inperson', value: 15 },
    { key: 'meeting_1on1_virtual', value: 10 },
    { key: 'meeting_group', value: 5 },
    { key: 'email', value: 5 },
    { key: 'linkedin_message', value: 4 },
    { key: 'linkedin_comment_given', value: 3 },
    { key: 'linkedin_comment_received', value: 3 },
    { key: 'linkedin_like_given', value: 1 },
    { key: 'linkedin_like_received', value: 1 },
    { key: 'introduction_given', value: 10 },
    { key: 'introduction_received', value: 10 },
    { key: 'manual_note', value: 8 },
    { key: 'connection_request_sent', value: 0 },
    { key: 'connection_request_accepted', value: 2 },
  ];

  for (const w of weights) {
    await prisma.scoringConfig.upsert({
      where: {
        configType_key: {
          configType: ScoringConfigType.relationship_weight,
          key: w.key,
        },
      },
      update: { value: w.value },
      create: {
        configType: ScoringConfigType.relationship_weight,
        key: w.key,
        value: w.value,
      },
    });
  }

  const general = [
    { key: 'recency_half_life_days', value: 90 },
    { key: 'reciprocity_threshold_pct', value: 30 },
    { key: 'reciprocity_multiplier_min', value: 1.3 },
    { key: 'reciprocity_multiplier_max', value: 1.5 },
  ];

  for (const g of general) {
    await prisma.scoringConfig.upsert({
      where: {
        configType_key: {
          configType: ScoringConfigType.general,
          key: g.key,
        },
      },
      update: { value: g.value },
      create: {
        configType: ScoringConfigType.general,
        key: g.key,
        value: g.value,
      },
    });
  }
});

afterAll(async () => {
  await prisma.scoreHistory.deleteMany();
  await prisma.statusHistory.deleteMany();
  await prisma.interaction.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.scoreHistory.deleteMany();
  await prisma.statusHistory.deleteMany();
  await prisma.interaction.deleteMany();
  await prisma.contact.deleteMany();
});

describe('calculateDecay', () => {
  it('returns 1 for today (0 days)', () => {
    expect(calculateDecay(0, 90)).toBe(1);
  });

  it('returns 0.5 at half-life (90 days)', () => {
    expect(calculateDecay(90, 90)).toBeCloseTo(0.5, 5);
  });

  it('returns 0.25 at double half-life (180 days)', () => {
    expect(calculateDecay(180, 90)).toBeCloseTo(0.25, 5);
  });

  it('returns ~0.81 at 30 days', () => {
    const decay = calculateDecay(30, 90);
    expect(decay).toBeGreaterThan(0.78);
    expect(decay).toBeLessThan(0.84);
  });
});

describe('calculateReciprocityMultiplier', () => {
  const config = {
    weights: new Map(),
    halfLifeDays: 90,
    reciprocityThresholdPct: 30,
    reciprocityMultiplierMin: 1.3,
    reciprocityMultiplierMax: 1.5,
  };

  it('returns 1.0 when no interactions', () => {
    expect(calculateReciprocityMultiplier(0, 0, config)).toBe(1.0);
  });

  it('returns 1.0 when reciprocal ratio is below threshold', () => {
    expect(calculateReciprocityMultiplier(2, 10, config)).toBe(1.0); // 20% < 30%
  });

  it('returns >= 1.3 when reciprocal ratio is at threshold', () => {
    const result = calculateReciprocityMultiplier(3, 10, config); // 30%
    expect(result).toBeCloseTo(1.3, 1);
  });

  it('returns 1.5 when reciprocal ratio is 100%', () => {
    const result = calculateReciprocityMultiplier(10, 10, config); // 100%
    expect(result).toBeCloseTo(1.5, 1);
  });

  it('scales linearly between min and max', () => {
    // 65% reciprocal → halfway between 30% and 100% = halfway between 1.3 and 1.5
    const result = calculateReciprocityMultiplier(65, 100, config);
    expect(result).toBeGreaterThan(1.3);
    expect(result).toBeLessThan(1.5);
  });
});

describe('loadScoringConfig', () => {
  it('loads weights and general config from database', async () => {
    const config = await loadScoringConfig();

    expect(config.weights.get('meeting_1on1_inperson')).toBe(15);
    expect(config.weights.get('linkedin_like_given')).toBe(1);
    expect(config.halfLifeDays).toBe(90);
    expect(config.reciprocityThresholdPct).toBe(30);
    expect(config.reciprocityMultiplierMin).toBe(1.3);
    expect(config.reciprocityMultiplierMax).toBe(1.5);
  });
});

describe('calculateContactScore', () => {
  it('returns 0 for contact with no interactions', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Alice', lastName: 'Smith' },
    });

    const config = await loadScoringConfig();
    const score = await calculateContactScore(contact.id, config);

    expect(score).toBe(0);
  });

  it('calculates score from recent interactions', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Bob', lastName: 'Jones' },
    });

    const now = new Date();
    await prisma.interaction.createMany({
      data: [
        {
          contactId: contact.id,
          type: 'meeting_1on1_inperson',
          occurredAt: now,
          pointsValue: 15,
        },
        {
          contactId: contact.id,
          type: 'email',
          occurredAt: now,
          pointsValue: 5,
        },
      ],
    });

    const config = await loadScoringConfig();
    const score = await calculateContactScore(contact.id, config, now);

    // 15 + 5 = 20 raw points, 20/150 * 100 = 13.3 → 13
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('applies decay to older interactions', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Carol', lastName: 'White' },
    });

    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    await prisma.interaction.create({
      data: {
        contactId: contact.id,
        type: 'meeting_1on1_inperson',
        occurredAt: ninetyDaysAgo,
        pointsValue: 15,
      },
    });

    const config = await loadScoringConfig();
    const score = await calculateContactScore(contact.id, config, now);

    // 15 * 0.5 = 7.5 raw points decayed, 7.5/150 * 100 = 5
    expect(score).toBe(5);
  });

  it('applies reciprocity multiplier when threshold is met', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Dave', lastName: 'Brown' },
    });

    const now = new Date();
    // 3 reciprocal + 1 outbound = 75% reciprocal ratio
    await prisma.interaction.createMany({
      data: [
        {
          contactId: contact.id,
          type: 'linkedin_comment_received',
          occurredAt: now,
          pointsValue: 3,
        },
        {
          contactId: contact.id,
          type: 'linkedin_like_received',
          occurredAt: now,
          pointsValue: 1,
        },
        {
          contactId: contact.id,
          type: 'introduction_received',
          occurredAt: now,
          pointsValue: 10,
        },
        {
          contactId: contact.id,
          type: 'linkedin_comment_given',
          occurredAt: now,
          pointsValue: 3,
        },
      ],
    });

    const config = await loadScoringConfig();
    const score = await calculateContactScore(contact.id, config, now);

    // Base: 3 + 1 + 10 + 3 = 17 raw
    // Reciprocal 75% → multiplier ~1.44
    // 17 * 1.44 = ~24.5 → 24.5/150*100 = ~16
    expect(score).toBeGreaterThan(10);
  });

  it('caps score at 100', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Eve', lastName: 'Green' },
    });

    const now = new Date();
    // Create many high-value interactions
    const interactions = [];
    for (let i = 0; i < 20; i++) {
      interactions.push({
        contactId: contact.id,
        type: 'meeting_1on1_inperson' as const,
        occurredAt: now,
        pointsValue: 15,
      });
    }
    await prisma.interaction.createMany({ data: interactions });

    const config = await loadScoringConfig();
    const score = await calculateContactScore(contact.id, config, now);

    expect(score).toBe(100);
  });
});

describe('processAllContactScores', () => {
  it('processes all contacts and updates scores', async () => {
    const contact1 = await prisma.contact.create({
      data: { firstName: 'Frank', lastName: 'Hall' },
    });
    const contact2 = await prisma.contact.create({
      data: { firstName: 'Grace', lastName: 'Lee' },
    });

    await prisma.interaction.create({
      data: {
        contactId: contact1.id,
        type: 'meeting_1on1_inperson',
        occurredAt: new Date(),
        pointsValue: 15,
      },
    });

    const result = await processAllContactScores();

    expect(result.processed).toBe(2);
    expect(result.updated).toBeGreaterThanOrEqual(1);

    // Check score was updated
    const updated1 = await prisma.contact.findUnique({ where: { id: contact1.id } });
    expect(updated1!.relationshipScore).toBeGreaterThan(0);

    // Contact with no interactions stays at 0
    const updated2 = await prisma.contact.findUnique({ where: { id: contact2.id } });
    expect(updated2!.relationshipScore).toBe(0);
  });

  it('logs scores to ScoreHistory', async () => {
    await prisma.contact.create({
      data: { firstName: 'Hank', lastName: 'Moore' },
    });

    await processAllContactScores();

    const history = await prisma.scoreHistory.findMany();
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].scoreType).toBe('relationship');
  });

  it('triggers status transitions when thresholds are met', async () => {
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Iris',
        lastName: 'King',
        status: 'connected',
        relationshipScore: 0,
      },
    });

    // Create enough interactions for promotion (score >= 30, >= 2 interactions)
    const now = new Date();
    const interactions = [];
    for (let i = 0; i < 5; i++) {
      interactions.push({
        contactId: contact.id,
        type: 'meeting_1on1_inperson' as const,
        occurredAt: now,
        pointsValue: 15,
      });
    }
    await prisma.interaction.createMany({ data: interactions });

    const result = await processAllContactScores();

    expect(result.transitions).toBeGreaterThanOrEqual(1);

    const updated = await prisma.contact.findUnique({ where: { id: contact.id } });
    expect(updated!.status).toBe('engaged');
  });
});
