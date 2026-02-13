import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { conflictRoutes } from '../conflicts.js';
import { contactRoutes } from '../contacts.js';
import { prisma } from '../../lib/prisma.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(contactRoutes, { prefix: '/api' });
  await app.register(conflictRoutes, { prefix: '/api' });
  await app.ready();
});

afterAll(async () => {
  await prisma.dataConflict.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.$disconnect();
  await app.close();
});

beforeEach(async () => {
  await prisma.dataConflict.deleteMany();
  await prisma.contact.deleteMany();
});

async function createContact(data: {
  firstName: string;
  lastName: string;
  company?: string;
  email?: string;
  title?: string;
}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/contacts',
    payload: data,
  });
  return res.json().data;
}

describe('GET /api/conflicts', () => {
  it('returns empty list when no conflicts', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/conflicts',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it('returns unresolved conflicts with contact details', async () => {
    const contact = await createContact({
      firstName: 'John',
      lastName: 'Doe',
      company: 'Acme',
      title: 'Engineer',
    });

    await prisma.dataConflict.create({
      data: {
        contactId: contact.id,
        fieldName: 'title',
        manualValue: 'Engineer',
        linkedinValue: 'Senior Engineer',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/conflicts',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].fieldName).toBe('title');
    expect(body.data[0].manualValue).toBe('Engineer');
    expect(body.data[0].linkedinValue).toBe('Senior Engineer');
    expect(body.data[0].contact.firstName).toBe('John');
  });

  it('filters by resolved status', async () => {
    const contact = await createContact({ firstName: 'A', lastName: 'B' });

    await prisma.dataConflict.createMany({
      data: [
        {
          contactId: contact.id,
          fieldName: 'title',
          manualValue: 'Old',
          linkedinValue: 'New',
          resolved: false,
        },
        {
          contactId: contact.id,
          fieldName: 'company',
          manualValue: 'OldCo',
          linkedinValue: 'NewCo',
          resolved: true,
          resolvedValue: 'NewCo',
          resolvedAt: new Date(),
        },
      ],
    });

    const unresolvedRes = await app.inject({
      method: 'GET',
      url: '/api/conflicts?resolved=false',
    });
    expect(unresolvedRes.json().data).toHaveLength(1);
    expect(unresolvedRes.json().data[0].fieldName).toBe('title');

    const resolvedRes = await app.inject({
      method: 'GET',
      url: '/api/conflicts?resolved=true',
    });
    expect(resolvedRes.json().data).toHaveLength(1);
    expect(resolvedRes.json().data[0].fieldName).toBe('company');
  });
});

describe('GET /api/conflicts/count', () => {
  it('returns count of unresolved conflicts', async () => {
    const contact = await createContact({ firstName: 'X', lastName: 'Y' });

    await prisma.dataConflict.createMany({
      data: [
        { contactId: contact.id, fieldName: 'title', manualValue: 'A', linkedinValue: 'B' },
        { contactId: contact.id, fieldName: 'company', manualValue: 'C', linkedinValue: 'D' },
        {
          contactId: contact.id,
          fieldName: 'location',
          manualValue: 'E',
          linkedinValue: 'F',
          resolved: true,
          resolvedValue: 'F',
          resolvedAt: new Date(),
        },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/conflicts/count',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.count).toBe(2);
  });
});

describe('PUT /api/conflicts/:id/resolve', () => {
  it('resolves a conflict and updates the contact field', async () => {
    const contact = await createContact({
      firstName: 'Jane',
      lastName: 'Smith',
      title: 'Manager',
    });

    const conflict = await prisma.dataConflict.create({
      data: {
        contactId: contact.id,
        fieldName: 'title',
        manualValue: 'Manager',
        linkedinValue: 'Senior Manager',
      },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/conflicts/${conflict.id}/resolve`,
      payload: { resolvedValue: 'Senior Manager' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.message).toBe('Conflict resolved');

    // Conflict should be resolved
    const updated = await prisma.dataConflict.findUnique({ where: { id: conflict.id } });
    expect(updated?.resolved).toBe(true);
    expect(updated?.resolvedValue).toBe('Senior Manager');
    expect(updated?.resolvedAt).not.toBeNull();

    // Contact field should be updated
    const updatedContact = await prisma.contact.findUnique({ where: { id: contact.id } });
    expect(updatedContact?.title).toBe('Senior Manager');
  });

  it('returns 404 for already-resolved conflict', async () => {
    const contact = await createContact({ firstName: 'A', lastName: 'B' });

    const conflict = await prisma.dataConflict.create({
      data: {
        contactId: contact.id,
        fieldName: 'title',
        manualValue: 'X',
        linkedinValue: 'Y',
        resolved: true,
        resolvedValue: 'Y',
        resolvedAt: new Date(),
      },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/conflicts/${conflict.id}/resolve`,
      payload: { resolvedValue: 'Y' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for invalid ID', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/conflicts/not-a-uuid/resolve',
      payload: { resolvedValue: 'test' },
    });

    expect(res.statusCode).toBe(400);
  });
});
