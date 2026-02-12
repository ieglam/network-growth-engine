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

describe('GET /api/contacts (list/search)', () => {
  it('returns all contacts with pagination', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'Alice', lastName: 'Alpha' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'Bob', lastName: 'Beta' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/contacts',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.pagination.total).toBe(2);
    expect(body.pagination.hasMore).toBe(false);
  });

  it('paginates results with limit and offset', async () => {
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { firstName: `User${i}`, lastName: 'Test' },
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: '/api/contacts?limit=2&offset=0',
    });

    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.pagination.total).toBe(5);
    expect(body.pagination.hasMore).toBe(true);

    const res2 = await app.inject({
      method: 'GET',
      url: '/api/contacts?limit=2&offset=4',
    });

    const body2 = res2.json();
    expect(body2.data).toHaveLength(1);
    expect(body2.pagination.hasMore).toBe(false);
  });

  it('filters by status', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'A', lastName: 'Target', status: 'target' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'B', lastName: 'Connected', status: 'connected' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'C', lastName: 'Engaged', status: 'engaged' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/contacts?status=target,connected',
    });

    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.pagination.total).toBe(2);
  });

  it('filters by score range', async () => {
    await prisma.contact.create({
      data: { firstName: 'Low', lastName: 'Score', relationshipScore: 10 },
    });
    await prisma.contact.create({
      data: { firstName: 'Mid', lastName: 'Score', relationshipScore: 50 },
    });
    await prisma.contact.create({
      data: { firstName: 'High', lastName: 'Score', relationshipScore: 90 },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/contacts?scoreMin=20&scoreMax=60',
    });

    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].firstName).toBe('Mid');
  });

  it('filters by location', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'A', lastName: 'NY', location: 'New York, NY' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'B', lastName: 'SF', location: 'San Francisco, CA' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/contacts?location=New York',
    });

    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].firstName).toBe('A');
  });

  it('sorts by name ascending', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'Zara', lastName: 'Zulu' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'Alice', lastName: 'Alpha' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/contacts?sort=name',
    });

    const body = res.json();
    expect(body.data[0].lastName).toBe('Alpha');
    expect(body.data[1].lastName).toBe('Zulu');
  });

  it('sorts by relationship_score descending', async () => {
    await prisma.contact.create({
      data: { firstName: 'Low', lastName: 'Score', relationshipScore: 10 },
    });
    await prisma.contact.create({
      data: { firstName: 'High', lastName: 'Score', relationshipScore: 80 },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/contacts?sort=-relationship_score',
    });

    const body = res.json();
    expect(body.data[0].firstName).toBe('High');
    expect(body.data[1].firstName).toBe('Low');
  });

  it('excludes soft-deleted contacts from list', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'Will', lastName: 'BeDeleted' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'Still', lastName: 'Here' },
    });
    const id = create.json().data.id;
    await app.inject({ method: 'DELETE', url: `/api/contacts/${id}` });

    const res = await app.inject({
      method: 'GET',
      url: '/api/contacts',
    });

    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0].firstName).toBe('Still');
  });

  it('performs full-text search across name, company, title', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'Alice', lastName: 'Johnson', company: 'TechCorp' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'Bob', lastName: 'Smith', company: 'HealthInc' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/contacts?q=TechCorp',
    });

    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].firstName).toBe('Alice');
    expect(body.pagination.total).toBe(1);
  });

  it('combines search with filters', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: {
        firstName: 'Alice',
        lastName: 'Johnson',
        company: 'TechCorp',
        status: 'connected',
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: {
        firstName: 'Bob',
        lastName: 'Johnson',
        company: 'TechCorp',
        status: 'target',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/contacts?q=TechCorp&status=connected',
    });

    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].firstName).toBe('Alice');
  });

  it('filters by category', async () => {
    // Create a category
    const category = await prisma.category.create({
      data: { name: 'test-category-filter', relevanceWeight: 5 },
    });

    const create = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'Cat', lastName: 'Contact' },
    });
    const contactId = create.json().data.id;

    // Assign category
    await prisma.contactCategory.create({
      data: { contactId, categoryId: category.id },
    });

    // Create another contact without category
    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'No', lastName: 'Category' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/contacts?category=${category.id}`,
    });

    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].firstName).toBe('Cat');

    // Cleanup
    await prisma.contactCategory.deleteMany();
    await prisma.category.delete({ where: { id: category.id } });
  });

  it('filters by tag', async () => {
    const tag = await prisma.tag.create({ data: { name: 'test-tag-filter' } });

    const create = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'Tagged', lastName: 'Contact' },
    });
    const contactId = create.json().data.id;

    await prisma.contactTag.create({
      data: { contactId, tagId: tag.id },
    });

    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'Untagged', lastName: 'Contact' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/contacts?tag=${tag.id}`,
    });

    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].firstName).toBe('Tagged');

    // Cleanup
    await prisma.contactTag.deleteMany();
    await prisma.tag.delete({ where: { id: tag.id } });
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
