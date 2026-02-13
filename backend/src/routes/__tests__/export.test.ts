import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { exportRoutes } from '../export.js';
import { prisma } from '../../lib/prisma.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(exportRoutes, { prefix: '/api' });
  await app.ready();
});

afterAll(async () => {
  await prisma.interaction.deleteMany();
  await prisma.statusHistory.deleteMany();
  await prisma.scoreHistory.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.category.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.$disconnect();
  await app.close();
});

beforeEach(async () => {
  await prisma.interaction.deleteMany();
  await prisma.statusHistory.deleteMany();
  await prisma.scoreHistory.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.category.deleteMany();
  await prisma.tag.deleteMany();
});

describe('GET /api/export/contacts', () => {
  it('exports contacts as JSON by default', async () => {
    await prisma.contact.create({
      data: { firstName: 'Alice', lastName: 'Smith', status: 'connected' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/export/contacts' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = res.json();
    expect(body.data.count).toBe(1);
    expect(body.data.contacts[0].firstName).toBe('Alice');
  });

  it('exports contacts as CSV', async () => {
    await prisma.contact.create({
      data: { firstName: 'Bob', lastName: 'Jones', status: 'target', company: 'Acme Inc' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/export/contacts?format=csv' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('contacts-export-');

    const lines = res.body.split('\n');
    expect(lines[0]).toContain('firstName');
    expect(lines[0]).toContain('lastName');
    expect(lines[1]).toContain('Bob');
    expect(lines[1]).toContain('Acme Inc');
  });

  it('CSV escapes fields with commas and quotes', async () => {
    await prisma.contact.create({
      data: {
        firstName: 'Carol',
        lastName: 'White',
        status: 'connected',
        company: 'Foo, Bar & "Baz" Inc',
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/export/contacts?format=csv' });

    const lines = res.body.split('\n');
    // Company with commas and quotes should be properly escaped
    expect(lines[1]).toContain('"Foo, Bar & ""Baz"" Inc"');
  });

  it('filters by status', async () => {
    await prisma.contact.createMany({
      data: [
        { firstName: 'A', lastName: 'One', status: 'connected' },
        { firstName: 'B', lastName: 'Two', status: 'target' },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/export/contacts?format=json&status=connected',
    });

    expect(res.json().data.count).toBe(1);
    expect(res.json().data.contacts[0].firstName).toBe('A');
  });

  it('filters by score range', async () => {
    await prisma.contact.createMany({
      data: [
        { firstName: 'Low', lastName: 'Score', status: 'connected', relationshipScore: 10 },
        { firstName: 'High', lastName: 'Score', status: 'connected', relationshipScore: 80 },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/export/contacts?format=json&scoreMin=50',
    });

    expect(res.json().data.count).toBe(1);
    expect(res.json().data.contacts[0].firstName).toBe('High');
  });

  it('filters by category', async () => {
    const cat = await prisma.category.create({
      data: { name: 'Export Test Cat', relevanceWeight: 5 },
    });

    const c1 = await prisma.contact.create({
      data: { firstName: 'InCat', lastName: 'One', status: 'connected' },
    });
    await prisma.contact.create({
      data: { firstName: 'NoCat', lastName: 'Two', status: 'connected' },
    });

    await prisma.contactCategory.create({
      data: { contactId: c1.id, categoryId: cat.id },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/export/contacts?format=json&category=${cat.id}`,
    });

    expect(res.json().data.count).toBe(1);
    expect(res.json().data.contacts[0].firstName).toBe('InCat');
  });

  it('includes categories and tags in export', async () => {
    const cat = await prisma.category.create({
      data: { name: 'VCs', relevanceWeight: 9 },
    });
    const tag = await prisma.tag.create({ data: { name: 'AI' } });

    const contact = await prisma.contact.create({
      data: { firstName: 'Dave', lastName: 'Brown', status: 'connected' },
    });

    await prisma.contactCategory.create({ data: { contactId: contact.id, categoryId: cat.id } });
    await prisma.contactTag.create({ data: { contactId: contact.id, tagId: tag.id } });

    const res = await app.inject({ method: 'GET', url: '/api/export/contacts?format=json' });

    const exported = res.json().data.contacts[0];
    expect(exported.categories[0].category.name).toBe('VCs');
    expect(exported.tags[0].tag.name).toBe('AI');
  });

  it('excludes soft-deleted contacts', async () => {
    await prisma.contact.createMany({
      data: [
        { firstName: 'Active', lastName: 'One', status: 'connected' },
        { firstName: 'Deleted', lastName: 'Two', status: 'connected', deletedAt: new Date() },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/api/export/contacts?format=json' });

    expect(res.json().data.count).toBe(1);
    expect(res.json().data.contacts[0].firstName).toBe('Active');
  });

  it('includes interactions when requested', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Eve', lastName: 'Green', status: 'connected' },
    });

    await prisma.interaction.create({
      data: {
        contactId: contact.id,
        type: 'linkedin_message',
        source: 'manual',
        occurredAt: new Date(),
        pointsValue: 5,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/export/contacts?format=json&includeInteractions=true',
    });

    const exported = res.json().data.contacts[0];
    expect(exported.interactions).toHaveLength(1);
    expect(exported.interactions[0].type).toBe('linkedin_message');
  });
});

describe('GET /api/export/contacts/:id', () => {
  it('exports single contact with full data', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Frank', lastName: 'Hall', status: 'engaged' },
    });

    await prisma.interaction.create({
      data: {
        contactId: contact.id,
        type: 'email',
        source: 'manual',
        occurredAt: new Date(),
        pointsValue: 4,
      },
    });

    await prisma.statusHistory.create({
      data: {
        contactId: contact.id,
        fromStatus: 'connected',
        toStatus: 'engaged',
        trigger: 'automated_promotion',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/export/contacts/${contact.id}`,
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.contact.firstName).toBe('Frank');
    expect(data.contact.interactions).toHaveLength(1);
    expect(data.contact.statusHistory).toHaveLength(1);
    expect(data.exportedAt).toBeDefined();
  });

  it('returns 404 for non-existent contact', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/export/contacts/00000000-0000-0000-0000-000000000000',
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for soft-deleted contact', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'Deleted', lastName: 'Person', status: 'target', deletedAt: new Date() },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/export/contacts/${contact.id}`,
    });

    expect(res.statusCode).toBe(404);
  });
});
