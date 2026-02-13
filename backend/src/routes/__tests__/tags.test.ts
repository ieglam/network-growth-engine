import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { tagRoutes } from '../tags.js';
import { contactRoutes } from '../contacts.js';
import { prisma } from '../../lib/prisma.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(contactRoutes, { prefix: '/api' });
  await app.register(tagRoutes, { prefix: '/api' });
  await app.ready();
});

afterAll(async () => {
  await prisma.contactTag.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.tag.deleteMany({ where: { name: { startsWith: 'test-' } } });
  await prisma.$disconnect();
  await app.close();
});

beforeEach(async () => {
  await prisma.contactTag.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.tag.deleteMany({ where: { name: { startsWith: 'test-' } } });
});

describe('GET /api/tags', () => {
  it('lists all tags with contact counts', async () => {
    const tag = await prisma.tag.create({ data: { name: 'test-tag-list' } });
    const contact = await prisma.contact.create({
      data: { firstName: 'John', lastName: 'Doe' },
    });
    await prisma.contactTag.create({
      data: { contactId: contact.id, tagId: tag.id },
    });

    const res = await app.inject({ method: 'GET', url: '/api/tags' });

    expect(res.statusCode).toBe(200);
    const testTags = res.json().data.filter((t: { name: string }) => t.name.startsWith('test-'));
    expect(testTags).toHaveLength(1);
    expect(testTags[0].contactCount).toBe(1);
  });
});

describe('GET /api/tags/autocomplete', () => {
  it('returns matching tags by prefix', async () => {
    await prisma.tag.create({ data: { name: 'test-alpha' } });
    await prisma.tag.create({ data: { name: 'test-beta' } });
    await prisma.tag.create({ data: { name: 'test-alphabet' } });

    const res = await app.inject({
      method: 'GET',
      url: '/api/tags/autocomplete?q=test-alph',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(2);
    expect(res.json().data.every((t: { name: string }) => t.name.startsWith('test-alph'))).toBe(
      true
    );
  });

  it('returns empty array for empty query', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tags/autocomplete?q=',
    });

    expect(res.json().data).toHaveLength(0);
  });
});

describe('POST /api/contacts/:id/tags', () => {
  it('adds tags to a contact, creating tags if needed', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'John', lastName: 'Doe' },
    });
    const contactId = create.json().data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/contacts/${contactId}/tags`,
      payload: { tags: ['test-new-tag-a', 'test-new-tag-b'] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.tags).toHaveLength(2);

    // Verify tags were created in DB
    const dbTags = await prisma.tag.findMany({
      where: { name: { in: ['test-new-tag-a', 'test-new-tag-b'] } },
    });
    expect(dbTags).toHaveLength(2);
  });

  it('is idempotent — re-adding same tag is fine', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'John', lastName: 'Doe' },
    });
    const contactId = create.json().data.id;

    await app.inject({
      method: 'POST',
      url: `/api/contacts/${contactId}/tags`,
      payload: { tags: ['test-idem'] },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/contacts/${contactId}/tags`,
      payload: { tags: ['test-idem'] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.tags).toHaveLength(1);
  });

  it('returns 404 for non-existent contact', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/contacts/00000000-0000-0000-0000-000000000000/tags',
      payload: { tags: ['test-orphan'] },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/contacts/:id/tags/:tagId', () => {
  it('removes a tag from a contact', async () => {
    const tag = await prisma.tag.create({ data: { name: 'test-remove-me' } });
    const contact = await prisma.contact.create({
      data: { firstName: 'John', lastName: 'Doe' },
    });
    await prisma.contactTag.create({
      data: { contactId: contact.id, tagId: tag.id },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/contacts/${contact.id}/tags/${tag.id}`,
    });

    expect(res.statusCode).toBe(200);

    const link = await prisma.contactTag.findFirst({
      where: { contactId: contact.id, tagId: tag.id },
    });
    expect(link).toBeNull();
  });

  it('returns 404 if tag not assigned', async () => {
    const tag = await prisma.tag.create({ data: { name: 'test-not-assigned' } });
    const contact = await prisma.contact.create({
      data: { firstName: 'John', lastName: 'Doe' },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/contacts/${contact.id}/tags/${tag.id}`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('TAG_NOT_ASSIGNED');
  });
});

describe('POST /api/contacts/bulk/tags', () => {
  it('adds a tag to multiple contacts', async () => {
    const tag = await prisma.tag.create({ data: { name: 'test-bulk-add' } });
    const c1 = await prisma.contact.create({
      data: { firstName: 'Alice', lastName: 'A' },
    });
    const c2 = await prisma.contact.create({
      data: { firstName: 'Bob', lastName: 'B' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/contacts/bulk/tags',
      payload: { contactIds: [c1.id, c2.id], tagId: tag.id },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.assigned).toBe(2);

    const links = await prisma.contactTag.findMany({
      where: { tagId: tag.id },
    });
    expect(links).toHaveLength(2);
  });

  it('returns 404 for non-existent tag', async () => {
    const contact = await prisma.contact.create({
      data: { firstName: 'John', lastName: 'Doe' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/contacts/bulk/tags',
      payload: {
        contactIds: [contact.id],
        tagId: '00000000-0000-0000-0000-000000000000',
      },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/contacts/bulk/tags', () => {
  it('removes a tag from multiple contacts', async () => {
    const tag = await prisma.tag.create({ data: { name: 'test-bulk-remove' } });
    const c1 = await prisma.contact.create({
      data: { firstName: 'Alice', lastName: 'A' },
    });
    const c2 = await prisma.contact.create({
      data: { firstName: 'Bob', lastName: 'B' },
    });

    await prisma.contactTag.createMany({
      data: [
        { contactId: c1.id, tagId: tag.id },
        { contactId: c2.id, tagId: tag.id },
      ],
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/contacts/bulk/tags',
      payload: { contactIds: [c1.id, c2.id], tagId: tag.id },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.removed).toBe(2);

    const links = await prisma.contactTag.findMany({
      where: { tagId: tag.id },
    });
    expect(links).toHaveLength(0);
  });
});
