import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { contactRoutes } from '../contacts.js';
import { prisma } from '../../lib/prisma.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(contactRoutes, { prefix: '/api' });
  await app.ready();
});

afterAll(async () => {
  await prisma.contact.deleteMany();
  await prisma.$disconnect();
  await app.close();
});

beforeEach(async () => {
  await prisma.contact.deleteMany();
});

describe('POST /api/contacts', () => {
  it('creates a contact with required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'John', lastName: 'Doe' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.firstName).toBe('John');
    expect(body.data.lastName).toBe('Doe');
    expect(body.data.status).toBe('target');
    expect(body.data.id).toBeDefined();
    expect(body.data.fieldSources).toEqual({
      firstName: 'manual',
      lastName: 'manual',
    });
  });

  it('creates a contact with all fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: {
        firstName: 'Jane',
        lastName: 'Smith',
        title: 'VP Engineering',
        company: 'Acme Corp',
        email: 'jane@acme.com',
        status: 'connected',
        seniority: 'vp',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.title).toBe('VP Engineering');
    expect(body.data.company).toBe('Acme Corp');
    expect(body.data.status).toBe('connected');
    expect(body.data.seniority).toBe('vp');
    expect(body.data.fieldSources).toMatchObject({
      firstName: 'manual',
      lastName: 'manual',
      title: 'manual',
      company: 'manual',
      email: 'manual',
    });
  });

  it('rejects missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'John' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects invalid email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'John', lastName: 'Doe', email: 'not-an-email' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects duplicate LinkedIn URL', async () => {
    const payload = {
      firstName: 'John',
      lastName: 'Doe',
      linkedinUrl: 'https://linkedin.com/in/johndoe',
    };

    await app.inject({ method: 'POST', url: '/api/contacts', payload });
    const res = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { ...payload, firstName: 'Jane' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('DUPLICATE_CONTACT');
  });
});

describe('GET /api/contacts/:id', () => {
  it('returns a contact by ID', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'John', lastName: 'Doe' },
    });
    const id = create.json().data.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/contacts/${id}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(id);
    expect(res.json().data.categories).toEqual([]);
    expect(res.json().data.tags).toEqual([]);
  });

  it('returns 404 for non-existent contact', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/contacts/00000000-0000-0000-0000-000000000000',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('CONTACT_NOT_FOUND');
  });

  it('returns 400 for invalid UUID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/contacts/not-a-uuid',
    });

    expect(res.statusCode).toBe(400);
  });

  it('does not return soft-deleted contacts', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'John', lastName: 'Doe' },
    });
    const id = create.json().data.id;

    await app.inject({ method: 'DELETE', url: `/api/contacts/${id}` });

    const res = await app.inject({
      method: 'GET',
      url: `/api/contacts/${id}`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /api/contacts/:id', () => {
  it('updates contact fields', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'John', lastName: 'Doe' },
    });
    const id = create.json().data.id;

    const res = await app.inject({
      method: 'PUT',
      url: `/api/contacts/${id}`,
      payload: { title: 'CEO', company: 'NewCo' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.title).toBe('CEO');
    expect(res.json().data.company).toBe('NewCo');
    expect(res.json().data.firstName).toBe('John');
  });

  it('merges field sources on update', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'John', lastName: 'Doe', title: 'CTO' },
    });
    const id = create.json().data.id;

    const res = await app.inject({
      method: 'PUT',
      url: `/api/contacts/${id}`,
      payload: { company: 'NewCo' },
    });

    expect(res.json().data.fieldSources).toMatchObject({
      firstName: 'manual',
      lastName: 'manual',
      title: 'manual',
      company: 'manual',
    });
  });

  it('returns 404 for non-existent contact', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/contacts/00000000-0000-0000-0000-000000000000',
      payload: { title: 'CEO' },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/contacts/:id', () => {
  it('soft-deletes a contact', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'John', lastName: 'Doe' },
    });
    const id = create.json().data.id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/contacts/${id}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(id);

    // Verify it's soft-deleted (still in DB but deletedAt is set)
    const dbRecord = await prisma.contact.findUnique({ where: { id } });
    expect(dbRecord).not.toBeNull();
    expect(dbRecord!.deletedAt).not.toBeNull();
  });

  it('returns 404 for already deleted contact', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'John', lastName: 'Doe' },
    });
    const id = create.json().data.id;

    await app.inject({ method: 'DELETE', url: `/api/contacts/${id}` });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/contacts/${id}`,
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for non-existent contact', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/contacts/00000000-0000-0000-0000-000000000000',
    });

    expect(res.statusCode).toBe(404);
  });
});
