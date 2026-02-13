import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { interactionRoutes } from '../interactions.js';
import { contactRoutes } from '../contacts.js';
import { prisma } from '../../lib/prisma.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(contactRoutes, { prefix: '/api' });
  await app.register(interactionRoutes, { prefix: '/api' });
  await app.ready();
});

afterAll(async () => {
  await prisma.interaction.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.$disconnect();
  await app.close();
});

beforeEach(async () => {
  await prisma.interaction.deleteMany();
  await prisma.contact.deleteMany();
});

describe('POST /api/contacts/:id/interactions', () => {
  it('creates a manual_note interaction', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Alice', lastName: 'Smith' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/contacts/${contact.id}/interactions`,
      payload: {
        type: 'manual_note',
        metadata: { notes: 'Met at conference' },
      },
    });

    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.type).toBe('manual_note');
    expect(data.source).toBe('manual');
    expect(data.pointsValue).toBe(1);
    expect(data.metadata).toEqual({ notes: 'Met at conference' });
  });

  it('creates a meeting interaction with points', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Bob', lastName: 'Jones' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/contacts/${contact.id}/interactions`,
      payload: {
        type: 'meeting_1on1_inperson',
        metadata: { location: 'Coffee shop downtown' },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.pointsValue).toBe(10);
  });

  it('updates contact lastInteractionAt', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Carol', lastName: 'White' },
    });

    expect(contact.lastInteractionAt).toBeNull();

    await app.inject({
      method: 'POST',
      url: `/api/contacts/${contact.id}/interactions`,
      payload: { type: 'email' },
    });

    const updated = await prisma.contact.findUnique({ where: { id: contact.id } });
    expect(updated!.lastInteractionAt).not.toBeNull();
  });

  it('accepts custom occurredAt timestamp', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Dave', lastName: 'Brown' },
    });

    const pastDate = '2025-06-15T10:00:00.000Z';
    const res = await app.inject({
      method: 'POST',
      url: `/api/contacts/${contact.id}/interactions`,
      payload: {
        type: 'linkedin_message',
        occurredAt: pastDate,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(new Date(res.json().data.occurredAt).toISOString()).toBe(pastDate);
  });

  it('accepts custom source', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Eve', lastName: 'Green' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/contacts/${contact.id}/interactions`,
      payload: {
        type: 'linkedin_comment_given',
        source: 'linkedin',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.source).toBe('linkedin');
  });

  it('returns 404 for non-existent contact', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/contacts/00000000-0000-0000-0000-000000000000/interactions',
      payload: { type: 'manual_note' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for invalid interaction type', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Frank', lastName: 'Hall' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/contacts/${contact.id}/interactions`,
      payload: { type: 'invalid_type' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('assigns correct points for each interaction type', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Grace', lastName: 'Lee' },
    });

    const typesAndPoints = [
      ['linkedin_message', 5],
      ['email', 4],
      ['meeting_1on1_virtual', 8],
      ['meeting_group', 4],
      ['linkedin_like_given', 1],
      ['linkedin_like_received', 2],
      ['introduction_given', 7],
      ['introduction_received', 8],
      ['connection_request_sent', 3],
      ['connection_request_accepted', 5],
    ] as const;

    for (const [type, expectedPoints] of typesAndPoints) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/contacts/${contact.id}/interactions`,
        payload: { type },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().data.pointsValue).toBe(expectedPoints);
    }
  });
});

describe('GET /api/contacts/:id/interactions', () => {
  it('lists interactions for a contact', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Hank', lastName: 'Moore' },
    });

    await prisma.interaction.createMany({
      data: [
        { contactId: contact.id, type: 'manual_note', occurredAt: new Date(), pointsValue: 1 },
        { contactId: contact.id, type: 'email', occurredAt: new Date(), pointsValue: 4 },
        {
          contactId: contact.id,
          type: 'meeting_1on1_inperson',
          occurredAt: new Date(),
          pointsValue: 10,
        },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/contacts/${contact.id}/interactions`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(3);
    expect(res.json().pagination.total).toBe(3);
  });

  it('returns interactions in descending order by occurredAt', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Iris', lastName: 'King' },
    });

    const earlier = new Date('2025-01-01');
    const later = new Date('2025-06-01');

    await prisma.interaction.createMany({
      data: [
        { contactId: contact.id, type: 'email', occurredAt: earlier, pointsValue: 4 },
        {
          contactId: contact.id,
          type: 'manual_note',
          occurredAt: later,
          pointsValue: 1,
        },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/contacts/${contact.id}/interactions`,
    });

    const data = res.json().data;
    expect(new Date(data[0].occurredAt).getTime()).toBeGreaterThan(
      new Date(data[1].occurredAt).getTime()
    );
  });

  it('filters by type', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Jack', lastName: 'Adams' },
    });

    await prisma.interaction.createMany({
      data: [
        { contactId: contact.id, type: 'email', occurredAt: new Date(), pointsValue: 4 },
        { contactId: contact.id, type: 'manual_note', occurredAt: new Date(), pointsValue: 1 },
        { contactId: contact.id, type: 'email', occurredAt: new Date(), pointsValue: 4 },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/contacts/${contact.id}/interactions?type=email`,
    });

    expect(res.json().data).toHaveLength(2);
    expect(res.json().pagination.total).toBe(2);
  });

  it('supports pagination', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Karen', lastName: 'Blake' },
    });

    for (let i = 0; i < 5; i++) {
      await prisma.interaction.create({
        data: {
          contactId: contact.id,
          type: 'manual_note',
          occurredAt: new Date(),
          pointsValue: 1,
        },
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: `/api/contacts/${contact.id}/interactions?limit=2&offset=0`,
    });

    expect(res.json().data).toHaveLength(2);
    expect(res.json().pagination.total).toBe(5);
    expect(res.json().pagination.hasMore).toBe(true);
  });

  it('returns 404 for non-existent contact', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/contacts/00000000-0000-0000-0000-000000000000/interactions',
    });

    expect(res.statusCode).toBe(404);
  });
});
