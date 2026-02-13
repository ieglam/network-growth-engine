import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { contactRoutes } from '../contacts.js';
import { prisma } from '../../lib/prisma.js';
import { checkStatusTransition, checkDemotion } from '../../services/statusTransitionService.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(contactRoutes, { prefix: '/api' });
  await app.ready();
});

afterAll(async () => {
  await prisma.statusHistory.deleteMany();
  await prisma.interaction.deleteMany();
  await prisma.scoreHistory.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.$disconnect();
  await app.close();
});

beforeEach(async () => {
  await prisma.statusHistory.deleteMany();
  await prisma.interaction.deleteMany();
  await prisma.scoreHistory.deleteMany();
  await prisma.contact.deleteMany();
});

describe('PUT /api/contacts/:id/status — Manual status override', () => {
  it('changes status from target to connected', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Alice', lastName: 'Smith', status: 'target' },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/contacts/${contact.id}/status`,
      payload: { status: 'connected', reason: 'Connected on LinkedIn' },
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.fromStatus).toBe('target');
    expect(data.toStatus).toBe('connected');
    expect(data.trigger).toBe('manual');
    expect(data.reason).toBe('Connected on LinkedIn');
  });

  it('logs transition in StatusHistory', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Bob', lastName: 'Jones', status: 'connected' },
    });

    await app.inject({
      method: 'PUT',
      url: `/api/contacts/${contact.id}/status`,
      payload: { status: 'engaged' },
    });

    const history = await prisma.statusHistory.findMany({
      where: { contactId: contact.id },
    });

    expect(history).toHaveLength(1);
    expect(history[0].fromStatus).toBe('connected');
    expect(history[0].toStatus).toBe('engaged');
    expect(history[0].trigger).toBe('manual');
  });

  it('returns no-change when status is the same', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Carol', lastName: 'White', status: 'engaged' },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/contacts/${contact.id}/status`,
      payload: { status: 'engaged' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.message).toBe('No status change needed');
    expect(res.json().data.currentStatus).toBe('engaged');
  });

  it('returns 404 for non-existent contact', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/contacts/00000000-0000-0000-0000-000000000000/status',
      payload: { status: 'connected' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for invalid status', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Dave', lastName: 'Brown', status: 'target' },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/contacts/${contact.id}/status`,
      payload: { status: 'invalid_status' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('checkStatusTransition — Automated promotion', () => {
  it('promotes connected → engaged when score >= 30 and interactions >= 2', async () => {
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Eve',
        lastName: 'Green',
        status: 'connected',
        relationshipScore: 35,
      },
    });

    await prisma.interaction.createMany({
      data: [
        {
          contactId: contact.id,
          type: 'linkedin_message',
          occurredAt: new Date(),
        },
        {
          contactId: contact.id,
          type: 'linkedin_comment_given',
          occurredAt: new Date(),
        },
      ],
    });

    const result = await checkStatusTransition(contact.id);

    expect(result).not.toBeNull();
    expect(result!.fromStatus).toBe('connected');
    expect(result!.toStatus).toBe('engaged');
    expect(result!.trigger).toBe('automated_promotion');

    const updated = await prisma.contact.findUnique({ where: { id: contact.id } });
    expect(updated!.status).toBe('engaged');
  });

  it('does not promote connected → engaged when score < 30', async () => {
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Frank',
        lastName: 'Hall',
        status: 'connected',
        relationshipScore: 20,
      },
    });

    await prisma.interaction.createMany({
      data: [
        {
          contactId: contact.id,
          type: 'linkedin_message',
          occurredAt: new Date(),
        },
        {
          contactId: contact.id,
          type: 'linkedin_comment_given',
          occurredAt: new Date(),
        },
      ],
    });

    const result = await checkStatusTransition(contact.id);
    expect(result).toBeNull();
  });

  it('does not promote connected → engaged when interactions < 2', async () => {
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Grace',
        lastName: 'Lee',
        status: 'connected',
        relationshipScore: 40,
      },
    });

    await prisma.interaction.create({
      data: {
        contactId: contact.id,
        type: 'linkedin_message',
        occurredAt: new Date(),
      },
    });

    const result = await checkStatusTransition(contact.id);
    expect(result).toBeNull();
  });

  it('promotes engaged → relationship when score >= 60 and reciprocal interaction exists', async () => {
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Hank',
        lastName: 'Moore',
        status: 'engaged',
        relationshipScore: 65,
      },
    });

    await prisma.interaction.create({
      data: {
        contactId: contact.id,
        type: 'linkedin_comment_received',
        occurredAt: new Date(),
      },
    });

    const result = await checkStatusTransition(contact.id);

    expect(result).not.toBeNull();
    expect(result!.fromStatus).toBe('engaged');
    expect(result!.toStatus).toBe('relationship');
    expect(result!.trigger).toBe('automated_promotion');
  });

  it('does not promote engaged → relationship without reciprocal interaction', async () => {
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Iris',
        lastName: 'King',
        status: 'engaged',
        relationshipScore: 70,
      },
    });

    await prisma.interaction.create({
      data: {
        contactId: contact.id,
        type: 'linkedin_message',
        occurredAt: new Date(),
      },
    });

    const result = await checkStatusTransition(contact.id);
    expect(result).toBeNull();
  });
});

describe('checkDemotion — Automated demotion', () => {
  it('demotes relationship → engaged when score < 60 for 30+ days', async () => {
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Jack',
        lastName: 'Adams',
        status: 'relationship',
        relationshipScore: 45,
      },
    });

    // Add score history older than 30 days (score was below 60 back then too)
    const fortyDaysAgo = new Date();
    fortyDaysAgo.setDate(fortyDaysAgo.getDate() - 40);
    await prisma.scoreHistory.create({
      data: {
        contactId: contact.id,
        scoreType: 'relationship',
        scoreValue: 50,
        recordedAt: fortyDaysAgo,
      },
    });

    const result = await checkDemotion(contact.id);

    expect(result).not.toBeNull();
    expect(result!.fromStatus).toBe('relationship');
    expect(result!.toStatus).toBe('engaged');
    expect(result!.trigger).toBe('automated_demotion');
  });

  it('does not demote relationship when recent high score exists', async () => {
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Karen',
        lastName: 'Blake',
        status: 'relationship',
        relationshipScore: 55,
      },
    });

    // Recent score above threshold
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    await prisma.scoreHistory.create({
      data: {
        contactId: contact.id,
        scoreType: 'relationship',
        scoreValue: 65,
        recordedAt: tenDaysAgo,
      },
    });

    const result = await checkDemotion(contact.id);
    expect(result).toBeNull();
  });

  it('demotes engaged → connected when score < 30 for 30+ days', async () => {
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Leo',
        lastName: 'Clark',
        status: 'engaged',
        relationshipScore: 20,
      },
    });

    const result = await checkDemotion(contact.id);

    expect(result).not.toBeNull();
    expect(result!.fromStatus).toBe('engaged');
    expect(result!.toStatus).toBe('connected');
    expect(result!.trigger).toBe('automated_demotion');
  });

  it('returns null for contacts not meeting demotion criteria', async () => {
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Mary',
        lastName: 'Davis',
        status: 'connected',
        relationshipScore: 10,
      },
    });

    const result = await checkDemotion(contact.id);
    expect(result).toBeNull();
  });
});
