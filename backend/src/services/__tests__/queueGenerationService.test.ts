import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { generateDailyQueue } from '../queueGenerationService.js';

beforeAll(async () => {
  // Ensure we have a template
  await prisma.template.deleteMany({ where: { name: { startsWith: 'QTest' } } });
  await prisma.template.create({
    data: {
      name: 'QTest Default',
      body: 'Hi {{first_name}}, I noticed your work at {{company}}. Would love to connect!',
      isActive: true,
    },
  });
});

afterAll(async () => {
  await prisma.queueItem.deleteMany();
  await prisma.scoreHistory.deleteMany();
  await prisma.statusHistory.deleteMany();
  await prisma.interaction.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.template.deleteMany({ where: { name: { startsWith: 'QTest' } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.queueItem.deleteMany();
  await prisma.scoreHistory.deleteMany();
  await prisma.statusHistory.deleteMany();
  await prisma.interaction.deleteMany();
  await prisma.contact.deleteMany();
});

describe('generateDailyQueue', () => {
  it('queues top targets by priority score', async () => {
    await prisma.contact.create({
      data: {
        firstName: 'Alice',
        lastName: 'Smith',
        status: 'target',
        priorityScore: 8.5,
        company: 'TechCorp',
      },
    });
    await prisma.contact.create({
      data: {
        firstName: 'Bob',
        lastName: 'Jones',
        status: 'target',
        priorityScore: 6.0,
      },
    });

    const result = await generateDailyQueue({ maxNewRequests: 5 });

    expect(result.connectionRequests).toBe(2);
    expect(result.total).toBe(2);

    const items = await prisma.queueItem.findMany({
      orderBy: { createdAt: 'asc' },
    });
    expect(items).toHaveLength(2);
    expect(items[0].actionType).toBe('connection_request');
    expect(items[0].status).toBe('pending');
  });

  it('renders personalized message from template', async () => {
    await prisma.contact.create({
      data: {
        firstName: 'Carol',
        lastName: 'White',
        status: 'target',
        priorityScore: 9.0,
        company: 'Acme Inc',
      },
    });

    await generateDailyQueue({ maxNewRequests: 5 });

    const item = await prisma.queueItem.findFirst();
    expect(item).not.toBeNull();
    // Should have a personalized message (from any matched template)
    expect(item!.personalizedMessage).toBeTruthy();
    expect(item!.personalizedMessage!.length).toBeGreaterThan(0);
  });

  it('flags items where rendered message exceeds 300 chars', async () => {
    // Deactivate all existing templates, then create one that renders > 300 chars
    await prisma.template.updateMany({ data: { isActive: false } });

    // Body is 297 chars: 270 x's + space + {{first_name}} + space + {{company}}
    const body = 'x'.repeat(270) + ' {{first_name}} {{company}}';
    await prisma.template.create({
      data: {
        name: 'QTest Long Template',
        body,
        isActive: true,
      },
    });

    // Contact with long name + company = renders > 300 chars
    // Rendered: 270 + 1 + 31 + 1 + 34 = 337 chars
    await prisma.contact.create({
      data: {
        firstName: 'Alexandrovichuuuuuuuuuuuuuuuuuu',
        lastName: 'Long',
        status: 'target',
        priorityScore: 9.0,
        company: 'SuperLongCompanyName International',
      },
    });

    const result = await generateDailyQueue({ maxNewRequests: 5 });

    expect(result.flaggedForEditing).toBe(1);

    const item = await prisma.queueItem.findFirst({
      where: { notes: { contains: 'EXCEEDS_300_CHARS' } },
    });
    expect(item).not.toBeNull();

    // Re-activate templates for other tests
    await prisma.template.updateMany({ data: { isActive: true } });
  });

  it('respects weekly rate limit', async () => {
    // Create 100 executed items this week
    const contact = await prisma.contact.create({
      data: { firstName: 'Dave', lastName: 'Brown', status: 'connected' },
    });

    const today = new Date();
    for (let i = 0; i < 100; i++) {
      await prisma.queueItem.create({
        data: {
          contactId: contact.id,
          queueDate: today,
          actionType: 'connection_request',
          status: 'executed',
          executedAt: today,
        },
      });
    }

    await prisma.contact.create({
      data: {
        firstName: 'Target',
        lastName: 'NoSlot',
        status: 'target',
        priorityScore: 10,
      },
    });

    const result = await generateDailyQueue({ weeklyLimit: 100 });

    expect(result.connectionRequests).toBe(0);
  });

  it('does not touch pending items from previous day', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Eve', lastName: 'Green', status: 'target', priorityScore: 7.0 },
    });

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    await prisma.queueItem.create({
      data: {
        contactId: contact.id,
        queueDate: yesterday,
        actionType: 'connection_request',
        status: 'pending',
      },
    });

    const result = await generateDailyQueue({ maxNewRequests: 5 });

    // The contact already has a pending queue item, so should not be re-queued
    expect(result.connectionRequests).toBe(0);

    const items = await prisma.queueItem.findMany({
      where: { contactId: contact.id },
    });
    // Only the original item from yesterday should exist
    expect(items).toHaveLength(1);
    expect(items[0].queueDate.toISOString().slice(0, 10)).toBe(yesterday.toISOString().slice(0, 10));
  });

  it('does not queue the same contact twice', async () => {
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Frank',
        lastName: 'Hall',
        status: 'target',
        priorityScore: 9.0,
      },
    });

    const today = new Date();
    await prisma.queueItem.create({
      data: {
        contactId: contact.id,
        queueDate: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
        actionType: 'connection_request',
        status: 'pending',
      },
    });

    const result = await generateDailyQueue({ maxNewRequests: 5 });

    // Should not add Frank again
    expect(result.connectionRequests).toBe(0);
  });

  it('adds follow-ups for recent connections without first message', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Grace', lastName: 'Lee', status: 'connected' },
    });

    // Add status history showing recent connection
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    await prisma.statusHistory.create({
      data: {
        contactId: contact.id,
        fromStatus: 'requested',
        toStatus: 'connected',
        trigger: 'manual',
        createdAt: threeDaysAgo,
      },
    });

    await generateDailyQueue();

    const item = await prisma.queueItem.findFirst({
      where: { contactId: contact.id },
    });
    expect(item).not.toBeNull();
    expect(item!.actionType).toBe('follow_up');
  });

  it('adds re-engagements for contacts with score drop > 15', async () => {
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Hank',
        lastName: 'Moore',
        status: 'engaged',
        relationshipScore: 30,
      },
    });

    // Add score history from 20 days ago with higher score
    const twentyDaysAgo = new Date();
    twentyDaysAgo.setDate(twentyDaysAgo.getDate() - 20);

    await prisma.scoreHistory.create({
      data: {
        contactId: contact.id,
        scoreType: 'relationship',
        scoreValue: 50,
        recordedAt: twentyDaysAgo,
      },
    });

    const result = await generateDailyQueue();

    expect(result.reEngagements).toBe(1);

    const item = await prisma.queueItem.findFirst({
      where: { contactId: contact.id },
    });
    expect(item!.actionType).toBe('re_engagement');
    expect(item!.notes).toContain('Score dropped');
  });

  it('limits connection requests to maxNewRequests', async () => {
    for (let i = 0; i < 10; i++) {
      await prisma.contact.create({
        data: {
          firstName: `Target${i}`,
          lastName: 'Test',
          status: 'target',
          priorityScore: 5 + i,
        },
      });
    }

    const result = await generateDailyQueue({ maxNewRequests: 3 });

    expect(result.connectionRequests).toBe(3);
  });
});
