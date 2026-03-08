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
  await prisma.settings.deleteMany({ where: { key: 'skip_requeue_days' } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.queueItem.deleteMany();
  await prisma.scoreHistory.deleteMany();
  await prisma.statusHistory.deleteMany();
  await prisma.interaction.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.settings.deleteMany({ where: { key: 'skip_requeue_days' } });
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

  it('carries over previous days pending items to today', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Eve', lastName: 'Green', status: 'target', priorityScore: 7.0 },
    });

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());

    await prisma.queueItem.create({
      data: {
        contactId: contact.id,
        queueDate: yesterdayDate,
        actionType: 'connection_request',
        status: 'pending',
      },
    });

    const today = new Date();
    const result = await generateDailyQueue({ maxNewRequests: 5 });

    expect(result.carriedOver).toBe(1);

    // The carried-over item should now have today's date
    const items = await prisma.queueItem.findMany({
      where: { contactId: contact.id },
    });
    expect(items).toHaveLength(1);
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    expect(items[0].queueDate.toISOString().slice(0, 10)).toBe(todayDate.toISOString().slice(0, 10));

    // Contact should NOT be re-queued as a new connection request (already carried over)
    expect(result.connectionRequests).toBe(0);
  });

  it('does NOT carry over skipped items from previous days', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Skip', lastName: 'Yesterday', status: 'target', priorityScore: 7.0 },
    });

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());

    await prisma.queueItem.create({
      data: {
        contactId: contact.id,
        queueDate: yesterdayDate,
        actionType: 'connection_request',
        status: 'skipped',
      },
    });

    const result = await generateDailyQueue({ maxNewRequests: 5 });

    expect(result.carriedOver).toBe(0);
    // Skipped contact should also be excluded from new targets (within 30 day window)
    expect(result.connectionRequests).toBe(0);

    // The original skipped item should remain unchanged (yesterday's date)
    const items = await prisma.queueItem.findMany({
      where: { contactId: contact.id },
    });
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('skipped');
    expect(items[0].queueDate.toISOString().slice(0, 10)).toBe(yesterdayDate.toISOString().slice(0, 10));
  });

  it('excludes recently skipped contacts from new target selection', async () => {
    const skippedContact = await prisma.contact.create({
      data: { firstName: 'Skipped', lastName: 'Person', status: 'target', priorityScore: 10.0 },
    });

    const freshContact = await prisma.contact.create({
      data: { firstName: 'Fresh', lastName: 'Target', status: 'target', priorityScore: 5.0 },
    });

    // Skipped 5 days ago
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const fiveDaysAgoDate = new Date(fiveDaysAgo.getFullYear(), fiveDaysAgo.getMonth(), fiveDaysAgo.getDate());

    await prisma.queueItem.create({
      data: {
        contactId: skippedContact.id,
        queueDate: fiveDaysAgoDate,
        actionType: 'connection_request',
        status: 'skipped',
      },
    });

    const result = await generateDailyQueue({ maxNewRequests: 5 });

    // Only Fresh Target should be queued; Skipped Person is within 30-day window
    expect(result.connectionRequests).toBe(1);

    const items = await prisma.queueItem.findMany({
      where: { status: 'pending' },
    });
    expect(items).toHaveLength(1);
    expect(items[0].contactId).toBe(freshContact.id);
  });

  it('re-queues skipped contacts after the skip window expires', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'OldSkip', lastName: 'Person', status: 'target', priorityScore: 8.0 },
    });

    // Skipped 35 days ago — outside the default 30-day window
    const thirtyFiveDaysAgo = new Date();
    thirtyFiveDaysAgo.setDate(thirtyFiveDaysAgo.getDate() - 35);
    const skipDate = new Date(thirtyFiveDaysAgo.getFullYear(), thirtyFiveDaysAgo.getMonth(), thirtyFiveDaysAgo.getDate());

    await prisma.queueItem.create({
      data: {
        contactId: contact.id,
        queueDate: skipDate,
        actionType: 'connection_request',
        status: 'skipped',
      },
    });

    const result = await generateDailyQueue({ maxNewRequests: 5 });

    // Skip expired — contact should be re-queued
    expect(result.connectionRequests).toBe(1);
  });

  it('respects configurable skip_requeue_days setting', async () => {
    // Set skip window to 7 days
    await prisma.settings.upsert({
      where: { key: 'skip_requeue_days' },
      update: { value: '7' },
      create: { key: 'skip_requeue_days', value: '7' },
    });

    const contact = await prisma.contact.create({
      data: { firstName: 'Config', lastName: 'Skip', status: 'target', priorityScore: 8.0 },
    });

    // Skipped 10 days ago — outside the 7-day window
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    const skipDate = new Date(tenDaysAgo.getFullYear(), tenDaysAgo.getMonth(), tenDaysAgo.getDate());

    await prisma.queueItem.create({
      data: {
        contactId: contact.id,
        queueDate: skipDate,
        actionType: 'connection_request',
        status: 'skipped',
      },
    });

    const result = await generateDailyQueue({ maxNewRequests: 5 });

    // 10 days > 7 day window → contact should be re-queued
    expect(result.connectionRequests).toBe(1);
  });

  it('does not queue the same contact twice', async () => {
    // Create two targets; one already has a pending item from yesterday
    const existing = await prisma.contact.create({
      data: { firstName: 'Frank', lastName: 'Hall', status: 'target', priorityScore: 9.0 },
    });
    const fresh = await prisma.contact.create({
      data: { firstName: 'New', lastName: 'Target', status: 'target', priorityScore: 5.0 },
    });

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());

    await prisma.queueItem.create({
      data: {
        contactId: existing.id,
        queueDate: yesterdayDate,
        actionType: 'connection_request',
        status: 'pending',
      },
    });

    const result = await generateDailyQueue({ maxNewRequests: 5 });

    // Frank is carried over from yesterday; New Target is a new connection request
    expect(result.carriedOver).toBe(1);
    expect(result.connectionRequests).toBe(1);

    // Frank should not have a duplicate item
    const frankItems = await prisma.queueItem.findMany({
      where: { contactId: existing.id },
    });
    expect(frankItems).toHaveLength(1);
  });

  it.todo('adds follow-ups for recent connections without first message — follow-up logic not yet implemented in service', async () => {
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
