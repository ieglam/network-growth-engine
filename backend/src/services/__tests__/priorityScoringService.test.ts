import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { ScoringConfigType } from '@prisma/client';
import {
  calculateRelevance,
  calculateAccessibility,
  calculateContactPriority,
  processAllPriorityScores,
} from '../priorityScoringService.js';

beforeAll(async () => {
  // Ensure scoring config exists
  const priorityWeights = [
    { key: 'relevance', value: 0.5 },
    { key: 'accessibility', value: 0.3 },
    { key: 'timing', value: 0.2 },
  ];

  for (const w of priorityWeights) {
    await prisma.scoringConfig.upsert({
      where: {
        configType_key: {
          configType: ScoringConfigType.priority_weight,
          key: w.key,
        },
      },
      update: { value: w.value },
      create: {
        configType: ScoringConfigType.priority_weight,
        key: w.key,
        value: w.value,
      },
    });
  }

  const generalConfig = [
    { key: 'seniority_multiplier_c_suite', value: 1.5 },
    { key: 'seniority_multiplier_vp', value: 1.5 },
    { key: 'seniority_multiplier_director', value: 1.2 },
    { key: 'seniority_multiplier_manager', value: 1.0 },
    { key: 'seniority_multiplier_ic', value: 0.8 },
  ];

  for (const g of generalConfig) {
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
  await prisma.interaction.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.interaction.deleteMany();
  await prisma.contact.deleteMany();
});

describe('calculateRelevance', () => {
  const seniorityMultipliers = {
    c_suite: 1.5,
    vp: 1.5,
    director: 1.2,
    manager: 1.0,
    ic: 0.8,
  };

  it('returns high score for top category + C-suite', async () => {
    const category = await prisma.category.upsert({
      where: { name: 'Test Crypto Client' },
      update: { relevanceWeight: 10 },
      create: { name: 'Test Crypto Client', relevanceWeight: 10 },
    });

    const contact = await prisma.contact.create({
      data: {
        firstName: 'Alice',
        lastName: 'Smith',
        status: 'target',
        seniority: 'c_suite',
        categories: {
          create: { categoryId: category.id },
        },
      },
    });

    const score = await calculateRelevance(contact.id, seniorityMultipliers);

    // 10 * 1.5 = 15, 15/15 * 10 = 10
    expect(score).toBe(10);
  });

  it('returns lower score for low category + IC', async () => {
    const category = await prisma.category.upsert({
      where: { name: 'Test General Contact' },
      update: { relevanceWeight: 3 },
      create: { name: 'Test General Contact', relevanceWeight: 3 },
    });

    const contact = await prisma.contact.create({
      data: {
        firstName: 'Bob',
        lastName: 'Jones',
        status: 'target',
        seniority: 'ic',
        categories: {
          create: { categoryId: category.id },
        },
      },
    });

    const score = await calculateRelevance(contact.id, seniorityMultipliers);

    // 3 * 0.8 = 2.4, 2.4/15 * 10 = 1.6
    expect(score).toBe(1.6);
  });

  it('uses highest category weight when multiple categories', async () => {
    const cat1 = await prisma.category.upsert({
      where: { name: 'Test Low Cat' },
      update: { relevanceWeight: 3 },
      create: { name: 'Test Low Cat', relevanceWeight: 3 },
    });
    const cat2 = await prisma.category.upsert({
      where: { name: 'Test High Cat' },
      update: { relevanceWeight: 9 },
      create: { name: 'Test High Cat', relevanceWeight: 9 },
    });

    const contact = await prisma.contact.create({
      data: {
        firstName: 'Carol',
        lastName: 'White',
        status: 'target',
        seniority: 'manager',
        categories: {
          create: [{ categoryId: cat1.id }, { categoryId: cat2.id }],
        },
      },
    });

    const score = await calculateRelevance(contact.id, seniorityMultipliers);

    // 9 * 1.0 = 9, 9/15 * 10 = 6
    expect(score).toBe(6);
  });

  it('defaults to weight 1 when no categories', async () => {
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Dave',
        lastName: 'Brown',
        status: 'target',
        seniority: 'vp',
      },
    });

    const score = await calculateRelevance(contact.id, seniorityMultipliers);

    // 1 * 1.5 = 1.5, 1.5/15 * 10 = 1
    expect(score).toBe(1);
  });
});

describe('calculateAccessibility', () => {
  it('returns points for 5+ mutual connections', async () => {
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Eve',
        lastName: 'Green',
        status: 'target',
        mutualConnectionsCount: 7,
      },
    });

    const score = await calculateAccessibility(contact.id);
    expect(score).toBe(4);
  });

  it('returns points for 2-4 mutual connections', async () => {
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Frank',
        lastName: 'Hall',
        status: 'target',
        mutualConnectionsCount: 3,
      },
    });

    const score = await calculateAccessibility(contact.id);
    expect(score).toBe(2);
  });

  it('adds points for active LinkedIn presence', async () => {
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Grace',
        lastName: 'Lee',
        status: 'target',
        isActiveOnLinkedin: true,
        mutualConnectionsCount: 0,
      },
    });

    const score = await calculateAccessibility(contact.id);
    expect(score).toBe(2);
  });

  it('adds points for warm intro (introductionSource set)', async () => {
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Hank',
        lastName: 'Moore',
        status: 'target',
        introductionSource: 'John from MBA',
        mutualConnectionsCount: 1,
      },
    });

    const score = await calculateAccessibility(contact.id);
    // 1 (mutual) + 3 (warm intro) = 4
    expect(score).toBe(4);
  });

  it('caps at 10', async () => {
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Iris',
        lastName: 'King',
        status: 'target',
        mutualConnectionsCount: 10,
        isActiveOnLinkedin: true,
        hasOpenToConnect: true,
        introductionSource: 'Warm intro',
      },
    });

    const score = await calculateAccessibility(contact.id);
    // 4 (mutual) + 2 (active) + 3 (intro) = 9, capped at 10
    expect(score).toBeLessThanOrEqual(10);
  });
});

describe('calculateContactPriority', () => {
  it('calculates weighted priority score', async () => {
    const category = await prisma.category.upsert({
      where: { name: 'Test Priority Cat' },
      update: { relevanceWeight: 8 },
      create: { name: 'Test Priority Cat', relevanceWeight: 8 },
    });

    const contact = await prisma.contact.create({
      data: {
        firstName: 'Jack',
        lastName: 'Adams',
        status: 'target',
        seniority: 'director',
        mutualConnectionsCount: 3,
        isActiveOnLinkedin: true,
        categories: {
          create: { categoryId: category.id },
        },
      },
    });

    const result = await calculateContactPriority(contact.id);

    expect(result).not.toBeNull();
    expect(result!.relevance).toBeGreaterThan(0);
    expect(result!.accessibility).toBeGreaterThan(0);
    expect(result!.timing).toBe(0); // Not yet implemented
    expect(result!.total).toBeGreaterThan(0);

    // Verify formula: (relevance * 0.5) + (accessibility * 0.3) + (timing * 0.2)
    const expected = result!.relevance * 0.5 + result!.accessibility * 0.3 + result!.timing * 0.2;
    expect(result!.total).toBeCloseTo(expected, 1);
  });
});

describe('processAllPriorityScores', () => {
  it('processes only target contacts', async () => {
    await prisma.contact.create({
      data: { firstName: 'Target', lastName: 'One', status: 'target' },
    });
    await prisma.contact.create({
      data: { firstName: 'Connected', lastName: 'Two', status: 'connected' },
    });

    const result = await processAllPriorityScores();

    expect(result.processed).toBe(1);
  });

  it('updates priority score in database', async () => {
    const category = await prisma.category.upsert({
      where: { name: 'Test Update Priority' },
      update: { relevanceWeight: 7 },
      create: { name: 'Test Update Priority', relevanceWeight: 7 },
    });

    const contact = await prisma.contact.create({
      data: {
        firstName: 'Karen',
        lastName: 'Blake',
        status: 'target',
        seniority: 'vp',
        mutualConnectionsCount: 5,
        categories: {
          create: { categoryId: category.id },
        },
      },
    });

    await processAllPriorityScores();

    const updated = await prisma.contact.findUnique({ where: { id: contact.id } });
    expect(Number(updated!.priorityScore)).toBeGreaterThan(0);
  });
});
