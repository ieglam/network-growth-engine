import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { dashboardRoutes } from '../dashboard.js';
import { prisma } from '../../lib/prisma.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(dashboardRoutes, { prefix: '/api' });
  await app.ready();
});

afterAll(async () => {
  await prisma.queueItem.deleteMany();
  await prisma.scoreHistory.deleteMany();
  await prisma.statusHistory.deleteMany();
  await prisma.interaction.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.category.deleteMany();
  await prisma.settings.deleteMany({ where: { key: 'network_goal' } });
  await prisma.$disconnect();
  await app.close();
});

beforeEach(async () => {
  await prisma.queueItem.deleteMany();
  await prisma.scoreHistory.deleteMany();
  await prisma.statusHistory.deleteMany();
  await prisma.interaction.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.category.deleteMany();
  await prisma.settings.deleteMany({ where: { key: 'network_goal' } });
});

describe('GET /api/dashboard/growth', () => {
  it('returns network size and goal', async () => {
    await prisma.contact.createMany({
      data: [
        { firstName: 'A', lastName: 'One', status: 'connected' },
        { firstName: 'B', lastName: 'Two', status: 'engaged' },
        { firstName: 'C', lastName: 'Three', status: 'relationship' },
        { firstName: 'D', lastName: 'Four', status: 'target' },
        { firstName: 'E', lastName: 'Five', status: 'requested' },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/growth' });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.networkSize).toBe(3); // connected + engaged + relationship
    expect(data.goal).toBe(7000);
    expect(data.progressPercent).toBeCloseTo(0.04, 1);
  });

  it('uses custom goal from settings', async () => {
    await prisma.settings.create({ data: { key: 'network_goal', value: '5000' } });
    await prisma.contact.create({
      data: { firstName: 'A', lastName: 'One', status: 'connected' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/growth' });

    expect(res.json().data.goal).toBe(5000);
  });

  it('calculates weekly and monthly growth from status history', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'A', lastName: 'One', status: 'connected' },
    });

    // 3 recent connections (this week)
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    for (let i = 0; i < 3; i++) {
      await prisma.statusHistory.create({
        data: {
          contactId: contact.id,
          fromStatus: 'requested',
          toStatus: 'connected',
          trigger: 'manual',
          createdAt: twoDaysAgo,
        },
      });
    }

    // 2 older connections (this month but not this week)
    const twentyDaysAgo = new Date();
    twentyDaysAgo.setDate(twentyDaysAgo.getDate() - 20);

    for (let i = 0; i < 2; i++) {
      await prisma.statusHistory.create({
        data: {
          contactId: contact.id,
          fromStatus: 'requested',
          toStatus: 'connected',
          trigger: 'manual',
          createdAt: twentyDaysAgo,
        },
      });
    }

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/growth' });
    const data = res.json().data;

    expect(data.weeklyGrowth).toBe(3);
    expect(data.monthlyGrowth).toBe(5);
  });

  it('calculates acceptance rate', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'A', lastName: 'One', status: 'connected' },
    });

    // 10 requested
    for (let i = 0; i < 10; i++) {
      await prisma.statusHistory.create({
        data: {
          contactId: contact.id,
          fromStatus: 'target',
          toStatus: 'requested',
          trigger: 'manual',
        },
      });
    }

    // 4 accepted
    for (let i = 0; i < 4; i++) {
      await prisma.statusHistory.create({
        data: {
          contactId: contact.id,
          fromStatus: 'requested',
          toStatus: 'connected',
          trigger: 'manual',
        },
      });
    }

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/growth' });
    const data = res.json().data;

    expect(data.acceptanceRate).toBe(40);
    expect(data.totalRequested).toBe(10);
    expect(data.totalAccepted).toBe(4);
  });
});

describe('GET /api/dashboard/categories', () => {
  it('returns category breakdown with contact counts', async () => {
    const cat = await prisma.category.create({
      data: { name: 'Tech Leaders', relevanceWeight: 8 },
    });

    const c1 = await prisma.contact.create({
      data: { firstName: 'A', lastName: 'One', status: 'connected' },
    });
    const c2 = await prisma.contact.create({
      data: { firstName: 'B', lastName: 'Two', status: 'target' },
    });

    await prisma.contactCategory.createMany({
      data: [
        { contactId: c1.id, categoryId: cat.id },
        { contactId: c2.id, categoryId: cat.id },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/categories' });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.categories).toHaveLength(1);
    expect(data.categories[0].name).toBe('Tech Leaders');
    expect(data.categories[0].totalContacts).toBe(2);
    expect(data.categories[0].statusBreakdown.connected).toBe(1);
    expect(data.categories[0].statusBreakdown.target).toBe(1);
  });

  it('counts uncategorized contacts', async () => {
    await prisma.contact.create({
      data: { firstName: 'Uncategorized', lastName: 'Person', status: 'connected' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/categories' });

    expect(res.json().data.uncategorized).toBe(1);
  });

  it('excludes soft-deleted contacts from counts', async () => {
    const cat = await prisma.category.create({
      data: { name: 'VCs', relevanceWeight: 9 },
    });

    const active = await prisma.contact.create({
      data: { firstName: 'Active', lastName: 'One', status: 'connected' },
    });
    const deleted = await prisma.contact.create({
      data: { firstName: 'Deleted', lastName: 'Two', status: 'connected', deletedAt: new Date() },
    });

    await prisma.contactCategory.createMany({
      data: [
        { contactId: active.id, categoryId: cat.id },
        { contactId: deleted.id, categoryId: cat.id },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/categories' });

    expect(res.json().data.categories[0].totalContacts).toBe(1);
  });
});

describe('GET /api/dashboard/scores', () => {
  it('returns score distribution by band', async () => {
    await prisma.contact.createMany({
      data: [
        { firstName: 'Cold1', lastName: 'C', status: 'connected', relationshipScore: 5 },
        { firstName: 'Cold2', lastName: 'C', status: 'connected', relationshipScore: 15 },
        { firstName: 'Warm1', lastName: 'W', status: 'engaged', relationshipScore: 35 },
        { firstName: 'Active1', lastName: 'A', status: 'engaged', relationshipScore: 60 },
        { firstName: 'Strong1', lastName: 'S', status: 'relationship', relationshipScore: 85 },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/scores' });

    expect(res.statusCode).toBe(200);
    const dist = res.json().data.distribution;
    expect(dist.cold).toBe(2);
    expect(dist.warm).toBe(1);
    expect(dist.active).toBe(1);
    expect(dist.strong).toBe(1);
    expect(dist.total).toBe(5);
  });

  it('returns top 10 strongest relationships', async () => {
    for (let i = 0; i < 15; i++) {
      await prisma.contact.create({
        data: {
          firstName: `Person${i}`,
          lastName: 'Test',
          status: 'connected',
          relationshipScore: i * 5,
        },
      });
    }

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/scores' });

    const top = res.json().data.topRelationships;
    expect(top).toHaveLength(10);
    expect(top[0].relationshipScore).toBe(70); // Person14 = 70
    expect(top[9].relationshipScore).toBe(25); // Person5 = 25
  });

  it('excludes targets and requested from score distribution', async () => {
    await prisma.contact.createMany({
      data: [
        { firstName: 'Target', lastName: 'T', status: 'target', relationshipScore: 10 },
        { firstName: 'Connected', lastName: 'C', status: 'connected', relationshipScore: 10 },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/scores' });

    expect(res.json().data.distribution.total).toBe(1);
  });
});

describe('GET /api/dashboard/trends', () => {
  it('returns network growth trend data', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'A', lastName: 'One', status: 'connected' },
    });

    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    await prisma.statusHistory.create({
      data: {
        contactId: contact.id,
        fromStatus: 'requested',
        toStatus: 'connected',
        trigger: 'manual',
        createdAt: twoWeeksAgo,
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/trends' });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.networkGrowth).toBeInstanceOf(Array);
    expect(data.networkGrowth.length).toBeGreaterThanOrEqual(1);
    expect(data.networkGrowth[0]).toHaveProperty('week');
    expect(data.networkGrowth[0]).toHaveProperty('newConnections');
  });

  it('returns empty arrays when no data exists', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/dashboard/trends' });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.networkGrowth).toEqual([]);
    expect(data.averageScore).toEqual([]);
    expect(data.queueExecution).toEqual([]);
  });

  it('returns queue execution trend', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'A', lastName: 'One', status: 'connected' },
    });

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    await prisma.queueItem.createMany({
      data: [
        {
          contactId: contact.id,
          queueDate: oneWeekAgo,
          actionType: 'connection_request',
          status: 'executed',
          executedAt: oneWeekAgo,
        },
        {
          contactId: contact.id,
          queueDate: oneWeekAgo,
          actionType: 'follow_up',
          status: 'skipped',
        },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/trends' });
    const data = res.json().data;

    expect(data.queueExecution.length).toBeGreaterThanOrEqual(1);
    const week = data.queueExecution[0];
    expect(week.total).toBe(2);
    expect(week.executed).toBe(1);
    expect(week.executionRate).toBe(50);
  });
});
