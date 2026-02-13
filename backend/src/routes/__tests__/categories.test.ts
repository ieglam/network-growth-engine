import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { categoryRoutes } from '../categories.js';
import { contactRoutes } from '../contacts.js';
import { prisma } from '../../lib/prisma.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(contactRoutes, { prefix: '/api' });
  await app.register(categoryRoutes, { prefix: '/api' });
  await app.ready();
});

afterAll(async () => {
  await prisma.contactCategory.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.category.deleteMany({ where: { name: { startsWith: 'Test' } } });
  await prisma.$disconnect();
  await app.close();
});

beforeEach(async () => {
  await prisma.contactCategory.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.category.deleteMany({ where: { name: { startsWith: 'Test' } } });
});

describe('GET /api/categories', () => {
  it('lists all categories with contact counts', async () => {
    await prisma.category.create({
      data: { name: 'Test Category A', relevanceWeight: 8 },
    });
    await prisma.category.create({
      data: { name: 'Test Category B', relevanceWeight: 5 },
    });

    const res = await app.inject({ method: 'GET', url: '/api/categories' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);

    const testCats = body.data.filter((c: { name: string }) => c.name.startsWith('Test'));
    expect(testCats).toHaveLength(2);
    expect(testCats[0].relevanceWeight).toBeGreaterThanOrEqual(testCats[1].relevanceWeight);
    expect(testCats[0].contactCount).toBeDefined();
  });
});

describe('POST /api/categories', () => {
  it('creates a category', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: 'Test New Cat', relevanceWeight: 7 },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.name).toBe('Test New Cat');
    expect(res.json().data.relevanceWeight).toBe(7);
  });

  it('rejects duplicate name', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: 'Test Unique', relevanceWeight: 5 },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: 'Test Unique', relevanceWeight: 3 },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('DUPLICATE_CATEGORY');
  });

  it('rejects missing fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: 'Test No Weight' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('PUT /api/categories/:id', () => {
  it('updates a category', async () => {
    const cat = await prisma.category.create({
      data: { name: 'Test Update Me', relevanceWeight: 5 },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/categories/${cat.id}`,
      payload: { name: 'Test Updated', relevanceWeight: 9 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.name).toBe('Test Updated');
    expect(res.json().data.relevanceWeight).toBe(9);
  });

  it('returns 404 for non-existent category', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/categories/00000000-0000-0000-0000-000000000000',
      payload: { name: 'Test Nope' },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/categories/:id', () => {
  it('deletes a category and unassigns from contacts', async () => {
    const cat = await prisma.category.create({
      data: { name: 'Test Delete Me', relevanceWeight: 3 },
    });

    const contact = await prisma.contact.create({
      data: { firstName: 'John', lastName: 'Doe' },
    });

    await prisma.contactCategory.create({
      data: { contactId: contact.id, categoryId: cat.id },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/categories/${cat.id}`,
    });

    expect(res.statusCode).toBe(200);

    // Category should be gone
    const dbCat = await prisma.category.findUnique({ where: { id: cat.id } });
    expect(dbCat).toBeNull();

    // Contact-category link should be gone
    const link = await prisma.contactCategory.findFirst({
      where: { categoryId: cat.id },
    });
    expect(link).toBeNull();
  });

  it('returns 404 for non-existent category', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/categories/00000000-0000-0000-0000-000000000000',
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/contacts/:id/categories', () => {
  it('assigns categories to a contact', async () => {
    const cat1 = await prisma.category.create({
      data: { name: 'Test Cat 1', relevanceWeight: 5 },
    });
    const cat2 = await prisma.category.create({
      data: { name: 'Test Cat 2', relevanceWeight: 8 },
    });

    const create = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'John', lastName: 'Doe' },
    });
    const contactId = create.json().data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/contacts/${contactId}/categories`,
      payload: { categoryIds: [cat1.id, cat2.id] },
    });

    expect(res.statusCode).toBe(200);
    const categories = res.json().data.categories;
    expect(categories).toHaveLength(2);
  });

  it('is idempotent — reassigning same category is fine', async () => {
    const cat = await prisma.category.create({
      data: { name: 'Test Idempotent', relevanceWeight: 5 },
    });

    const create = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'John', lastName: 'Doe' },
    });
    const contactId = create.json().data.id;

    await app.inject({
      method: 'POST',
      url: `/api/contacts/${contactId}/categories`,
      payload: { categoryIds: [cat.id] },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/contacts/${contactId}/categories`,
      payload: { categoryIds: [cat.id] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.categories).toHaveLength(1);
  });

  it('returns 404 for non-existent contact', async () => {
    const cat = await prisma.category.create({
      data: { name: 'Test Orphan', relevanceWeight: 5 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/contacts/00000000-0000-0000-0000-000000000000/categories',
      payload: { categoryIds: [cat.id] },
    });

    expect(res.statusCode).toBe(404);
  });

  it('rejects invalid category IDs', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'John', lastName: 'Doe' },
    });
    const contactId = create.json().data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/contacts/${contactId}/categories`,
      payload: { categoryIds: ['00000000-0000-0000-0000-000000000000'] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_CATEGORY');
  });
});
