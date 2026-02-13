import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { duplicateRoutes } from '../duplicates.js';
import { contactRoutes } from '../contacts.js';
import { prisma } from '../../lib/prisma.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(contactRoutes, { prefix: '/api' });
  await app.register(duplicateRoutes, { prefix: '/api' });
  await app.ready();
});

afterAll(async () => {
  await prisma.duplicatePair.deleteMany();
  await prisma.mergeHistory.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.$disconnect();
  await app.close();
});

beforeEach(async () => {
  await prisma.duplicatePair.deleteMany();
  await prisma.mergeHistory.deleteMany();
  await prisma.contact.deleteMany();
});

async function createContact(data: {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  company?: string;
  linkedinUrl?: string;
}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/contacts',
    payload: data,
  });
  return res.json().data;
}

describe('GET /api/duplicates', () => {
  it('returns empty list when no duplicates', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/duplicates',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it('returns pending duplicate pairs with contact details', async () => {
    const a = await createContact({ firstName: 'John', lastName: 'Doe', company: 'Acme' });
    const b = await createContact({ firstName: 'John', lastName: 'Doe', company: 'Acme' });

    // Manually create a pair
    await prisma.duplicatePair.create({
      data: {
        contactAId: a.id < b.id ? a.id : b.id,
        contactBId: a.id < b.id ? b.id : a.id,
        matchType: 'name_company',
        confidence: 'medium',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/duplicates',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].matchType).toBe('name_company');
    expect(body.data[0].contactA.firstName).toBe('John');
    expect(body.data[0].contactB.firstName).toBe('John');
  });
});

describe('POST /api/duplicates/scan', () => {
  it('detects name+company duplicates and flags for review', async () => {
    await createContact({ firstName: 'Jane', lastName: 'Smith', company: 'BigCo' });
    await createContact({ firstName: 'Jane', lastName: 'Smith', company: 'BigCo' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/duplicates/scan',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.flagged).toBe(1);

    // Should be stored as pending
    const pairs = await prisma.duplicatePair.findMany({ where: { status: 'pending' } });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].matchType).toBe('name_company');
  });

  it('does not re-flag dismissed pairs', async () => {
    const a = await createContact({ firstName: 'Bob', lastName: 'Lee', company: 'TestCo' });
    const b = await createContact({ firstName: 'Bob', lastName: 'Lee', company: 'TestCo' });

    // First scan flags it
    await app.inject({ method: 'POST', url: '/api/duplicates/scan' });

    // Dismiss it
    const pairs = await prisma.duplicatePair.findMany({ where: { status: 'pending' } });
    await prisma.duplicatePair.update({
      where: { id: pairs[0].id },
      data: { status: 'dismissed', resolvedAt: new Date() },
    });

    // Second scan should not re-flag
    const res = await app.inject({ method: 'POST', url: '/api/duplicates/scan' });
    const body = res.json();
    expect(body.data.flagged).toBe(0);

    // Original dismissed pair should still be there
    const allPairs = await prisma.duplicatePair.findMany({
      where: {
        OR: [
          { contactAId: a.id, contactBId: b.id },
          { contactAId: b.id, contactBId: a.id },
        ],
      },
    });
    expect(allPairs).toHaveLength(1);
    expect(allPairs[0].status).toBe('dismissed');
  });
});

describe('PUT /api/duplicates/:id/merge', () => {
  it('merges a duplicate pair and soft-deletes secondary', async () => {
    const a = await createContact({
      firstName: 'Alice',
      lastName: 'Wang',
      company: 'Corp',
      email: 'alice@corp.com',
    });
    const b = await createContact({
      firstName: 'Alice',
      lastName: 'Wang',
      company: 'Corp',
      phone: '+1234567890',
    });

    // Create pair
    const pair = await prisma.duplicatePair.create({
      data: {
        contactAId: a.id < b.id ? a.id : b.id,
        contactBId: a.id < b.id ? b.id : a.id,
        matchType: 'name_company',
        confidence: 'medium',
      },
    });

    // Merge, keeping A as primary
    const res = await app.inject({
      method: 'PUT',
      url: `/api/duplicates/${pair.id}/merge`,
      payload: { primaryContactId: a.id },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.primaryContactId).toBe(a.id);

    // Primary should have phone from secondary
    const primary = await prisma.contact.findUnique({ where: { id: a.id } });
    expect(primary?.phone).toBe('+1234567890');
    expect(primary?.email).toBe('alice@corp.com');

    // Secondary should be soft-deleted
    const secondary = await prisma.contact.findUnique({ where: { id: b.id } });
    expect(secondary?.deletedAt).not.toBeNull();

    // Merge history recorded
    const history = await prisma.mergeHistory.findMany({ where: { primaryContactId: a.id } });
    expect(history).toHaveLength(1);
    expect(history[0].mergeType).toBe('manual');
  });

  it('returns 404 for already-resolved pair', async () => {
    const a = await createContact({ firstName: 'X', lastName: 'Y', company: 'Z' });
    const b = await createContact({ firstName: 'X', lastName: 'Y', company: 'Z' });

    const pair = await prisma.duplicatePair.create({
      data: {
        contactAId: a.id < b.id ? a.id : b.id,
        contactBId: a.id < b.id ? b.id : a.id,
        matchType: 'name_company',
        confidence: 'medium',
        status: 'dismissed',
        resolvedAt: new Date(),
      },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/duplicates/${pair.id}/merge`,
      payload: { primaryContactId: a.id },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /api/duplicates/:id/dismiss', () => {
  it('dismisses a duplicate pair', async () => {
    const a = await createContact({ firstName: 'Tom', lastName: 'Lee', company: 'Q' });
    const b = await createContact({ firstName: 'Tom', lastName: 'Lee', company: 'Q' });

    const pair = await prisma.duplicatePair.create({
      data: {
        contactAId: a.id < b.id ? a.id : b.id,
        contactBId: a.id < b.id ? b.id : a.id,
        matchType: 'name_company',
        confidence: 'medium',
      },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/duplicates/${pair.id}/dismiss`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.message).toBe('Duplicate pair dismissed');

    const updated = await prisma.duplicatePair.findUnique({ where: { id: pair.id } });
    expect(updated?.status).toBe('dismissed');
    expect(updated?.resolvedAt).not.toBeNull();
  });

  it('returns 404 for non-pending pair', async () => {
    const a = await createContact({ firstName: 'A', lastName: 'B', company: 'C' });
    const b = await createContact({ firstName: 'A', lastName: 'B', company: 'C' });

    const pair = await prisma.duplicatePair.create({
      data: {
        contactAId: a.id < b.id ? a.id : b.id,
        contactBId: a.id < b.id ? b.id : a.id,
        matchType: 'name_company',
        confidence: 'medium',
        status: 'merged',
        resolvedAt: new Date(),
      },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/duplicates/${pair.id}/dismiss`,
    });

    expect(res.statusCode).toBe(404);
  });
});
