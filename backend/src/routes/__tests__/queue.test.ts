import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { queueRoutes } from '../queue.js';
import { prisma } from '../../lib/prisma.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(queueRoutes, { prefix: '/api' });
  await app.ready();
});

afterAll(async () => {
  await prisma.queueItem.deleteMany();
  await prisma.interaction.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.$disconnect();
  await app.close();
});

beforeEach(async () => {
  await prisma.queueItem.deleteMany();
  await prisma.interaction.deleteMany();
  await prisma.contact.deleteMany();
});

function todayDate() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

describe('GET /api/queue/today', () => {
  it("returns today's queue items", async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Alice', lastName: 'Smith', status: 'target' },
    });

    await prisma.queueItem.create({
      data: {
        contactId: contact.id,
        queueDate: todayDate(),
        actionType: 'connection_request',
        personalizedMessage: 'Hi Alice!',
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/queue/today' });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0].contact.firstName).toBe('Alice');
  });

  it('does not return items from other days', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Bob', lastName: 'Jones', status: 'target' },
    });

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    await prisma.queueItem.create({
      data: {
        contactId: contact.id,
        queueDate: yesterday,
        actionType: 'connection_request',
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/queue/today' });

    expect(res.json().data).toHaveLength(0);
  });
});

describe('GET /api/queue/summary', () => {
  it('returns counts by status', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Carol', lastName: 'White', status: 'target' },
    });

    const today = todayDate();
    await prisma.queueItem.createMany({
      data: [
        {
          contactId: contact.id,
          queueDate: today,
          actionType: 'connection_request',
          status: 'pending',
        },
        { contactId: contact.id, queueDate: today, actionType: 'follow_up', status: 'approved' },
        {
          contactId: contact.id,
          queueDate: today,
          actionType: 're_engagement',
          status: 'executed',
          executedAt: new Date(),
        },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/queue/summary' });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.pending).toBe(1);
    expect(data.approved).toBe(1);
    expect(data.executed).toBe(1);
    expect(data.total).toBe(3);
  });
});

describe('PUT /api/queue/:id/done', () => {
  it('marks item as executed and logs interaction', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Dave', lastName: 'Brown', status: 'target' },
    });

    const item = await prisma.queueItem.create({
      data: {
        contactId: contact.id,
        queueDate: todayDate(),
        actionType: 'connection_request',
        status: 'approved',
      },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/queue/${item.id}/done`,
      payload: { notes: 'Sent successfully' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('executed');
    expect(res.json().data.result).toBe('success');

    // Check interaction was logged
    const interactions = await prisma.interaction.findMany({
      where: { contactId: contact.id },
    });
    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('connection_request_sent');

    // Check lastInteractionAt was updated
    const updated = await prisma.contact.findUnique({ where: { id: contact.id } });
    expect(updated!.lastInteractionAt).not.toBeNull();
  });

  it('returns 404 for non-existent item', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/queue/00000000-0000-0000-0000-000000000000/done',
      payload: {},
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /api/queue/:id/skip', () => {
  it('marks item as skipped', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Eve', lastName: 'Green', status: 'target' },
    });

    const item = await prisma.queueItem.create({
      data: {
        contactId: contact.id,
        queueDate: todayDate(),
        actionType: 'connection_request',
      },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/queue/${item.id}/skip`,
      payload: { reason: 'Not a good fit right now' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('skipped');
    expect(res.json().data.notes).toBe('Not a good fit right now');
  });
});

describe('PUT /api/queue/:id/snooze', () => {
  it('snoozes item to a future date', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Frank', lastName: 'Hall', status: 'target' },
    });

    const item = await prisma.queueItem.create({
      data: {
        contactId: contact.id,
        queueDate: todayDate(),
        actionType: 'connection_request',
      },
    });

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/queue/${item.id}/snooze`,
      payload: { snoozeUntil: futureDate.toISOString() },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('snoozed');
    expect(res.json().data.snoozeUntil).not.toBeNull();
  });

  it('returns 400 without snoozeUntil date', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Grace', lastName: 'Lee', status: 'target' },
    });

    const item = await prisma.queueItem.create({
      data: {
        contactId: contact.id,
        queueDate: todayDate(),
        actionType: 'connection_request',
      },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/queue/${item.id}/snooze`,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/queue/approve', () => {
  it('batch approves pending items', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Hank', lastName: 'Moore', status: 'target' },
    });

    const today = todayDate();
    const items = await Promise.all([
      prisma.queueItem.create({
        data: { contactId: contact.id, queueDate: today, actionType: 'connection_request' },
      }),
      prisma.queueItem.create({
        data: { contactId: contact.id, queueDate: today, actionType: 'follow_up' },
      }),
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/queue/approve',
      payload: { ids: items.map((i) => i.id) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.approved).toBe(2);

    // Verify status changed
    const updated = await prisma.queueItem.findMany({
      where: { id: { in: items.map((i) => i.id) } },
    });
    expect(updated.every((i) => i.status === 'approved')).toBe(true);
  });

  it('only approves pending items, not already executed', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Iris', lastName: 'King', status: 'target' },
    });

    const today = todayDate();
    const pending = await prisma.queueItem.create({
      data: {
        contactId: contact.id,
        queueDate: today,
        actionType: 'connection_request',
        status: 'pending',
      },
    });
    const executed = await prisma.queueItem.create({
      data: {
        contactId: contact.id,
        queueDate: today,
        actionType: 'follow_up',
        status: 'executed',
        executedAt: new Date(),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/queue/approve',
      payload: { ids: [pending.id, executed.id] },
    });

    expect(res.json().data.approved).toBe(1);
  });
});
