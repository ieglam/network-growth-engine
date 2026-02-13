import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { templateRoutes } from '../templates.js';
import { contactRoutes } from '../contacts.js';
import { prisma } from '../../lib/prisma.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(contactRoutes, { prefix: '/api' });
  await app.register(templateRoutes, { prefix: '/api' });
  await app.ready();
});

afterAll(async () => {
  await prisma.contact.deleteMany();
  await prisma.template.deleteMany({ where: { name: { startsWith: 'Test' } } });
  await prisma.$disconnect();
  await app.close();
});

beforeEach(async () => {
  await prisma.contact.deleteMany();
  await prisma.template.deleteMany({ where: { name: { startsWith: 'Test' } } });
});

describe('GET /api/templates', () => {
  it('lists all templates', async () => {
    await prisma.template.create({
      data: { name: 'Test Template A', persona: 'crypto', body: 'Hello {{first_name}}' },
    });
    await prisma.template.create({
      data: { name: 'Test Template B', persona: 'general', body: 'Hi {{first_name}}' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/templates' });

    expect(res.statusCode).toBe(200);
    const testTemplates = res
      .json()
      .data.filter((t: { name: string }) => t.name.startsWith('Test'));
    expect(testTemplates).toHaveLength(2);
  });

  it('filters by persona', async () => {
    await prisma.template.create({
      data: { name: 'Test Crypto', persona: 'crypto', body: 'Crypto note' },
    });
    await prisma.template.create({
      data: { name: 'Test General', persona: 'general', body: 'General note' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/templates?persona=crypto',
    });

    const testTemplates = res
      .json()
      .data.filter((t: { name: string }) => t.name.startsWith('Test'));
    expect(testTemplates).toHaveLength(1);
    expect(testTemplates[0].persona).toBe('crypto');
  });

  it('filters by active status', async () => {
    await prisma.template.create({
      data: {
        name: 'Test Active',
        persona: 'test',
        body: 'Active',
        isActive: true,
      },
    });
    await prisma.template.create({
      data: {
        name: 'Test Inactive',
        persona: 'test',
        body: 'Inactive',
        isActive: false,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/templates?active=true',
    });

    const testTemplates = res
      .json()
      .data.filter((t: { name: string }) => t.name.startsWith('Test'));
    expect(testTemplates).toHaveLength(1);
    expect(testTemplates[0].name).toBe('Test Active');
  });
});

describe('POST /api/templates', () => {
  it('creates a template', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: 'Test New Template',
        persona: 'crypto',
        body: 'Hi {{first_name}}, I noticed your work at {{company}}.',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.name).toBe('Test New Template');
    expect(res.json().data.persona).toBe('crypto');
    expect(res.json().data.isActive).toBe(true);
  });

  it('rejects body exceeding 300 characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: 'Test Too Long',
        persona: 'test',
        body: 'x'.repeat(301),
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('allows body at exactly 300 characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: 'Test Exact 300',
        persona: 'test',
        body: 'x'.repeat(300),
      },
    });

    expect(res.statusCode).toBe(201);
  });

  it('rejects missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: { name: 'Test No Body' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('supports tokens in body', async () => {
    const body =
      'Hi {{first_name}}, I see you work at {{company}} as {{title}}. ' +
      'Our mutual connection {{mutual_connection}} suggested I reach out.';

    const res = await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: 'Test With Tokens',
        persona: 'general',
        body,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.body).toContain('{{first_name}}');
  });
});

describe('PUT /api/templates/:id', () => {
  it('updates a template', async () => {
    const tmpl = await prisma.template.create({
      data: { name: 'Test Update Me', persona: 'old', body: 'Old body' },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/templates/${tmpl.id}`,
      payload: { persona: 'new', body: 'New body' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.persona).toBe('new');
    expect(res.json().data.body).toBe('New body');
    expect(res.json().data.name).toBe('Test Update Me');
  });

  it('returns 404 for non-existent template', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/templates/00000000-0000-0000-0000-000000000000',
      payload: { body: 'Nope' },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/templates/:id', () => {
  it('deletes a template', async () => {
    const tmpl = await prisma.template.create({
      data: { name: 'Test Delete Me', persona: 'test', body: 'Bye' },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/templates/${tmpl.id}`,
    });

    expect(res.statusCode).toBe(200);

    const dbTmpl = await prisma.template.findUnique({
      where: { id: tmpl.id },
    });
    expect(dbTmpl).toBeNull();
  });

  it('returns 404 for non-existent template', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/templates/00000000-0000-0000-0000-000000000000',
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/templates/:id/render', () => {
  it('renders template with contact data', async () => {
    const tmpl = await prisma.template.create({
      data: {
        name: 'Test Render',
        persona: 'general',
        body: 'Hi {{first_name}}, I see you work at {{company}} as {{title}}.',
      },
    });

    const contact = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: {
        firstName: 'Alice',
        lastName: 'Smith',
        company: 'TechCorp',
        title: 'VP Engineering',
      },
    });
    const contactId = contact.json().data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/templates/${tmpl.id}/render`,
      payload: { contactId },
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.rendered).toBe('Hi Alice, I see you work at TechCorp as VP Engineering.');
    expect(data.characterCount).toBe(55);
    expect(data.exceeds300).toBe(false);
  });

  it('removes missing token values', async () => {
    const tmpl = await prisma.template.create({
      data: {
        name: 'Test Missing Tokens',
        persona: 'general',
        body: 'Hi {{first_name}}, {{mutual_connection}} mentioned you.',
      },
    });

    const contact = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'Bob', lastName: 'Jones' },
    });
    const contactId = contact.json().data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/templates/${tmpl.id}/render`,
      payload: { contactId },
    });

    expect(res.json().data.rendered).toBe('Hi Bob,  mentioned you.');
  });

  it('warns when rendered output exceeds 300 chars', async () => {
    const longBody = '{{first_name}} '.repeat(20) + '{{company}} '.repeat(20) + 'end.';
    const tmpl = await prisma.template.create({
      data: { name: 'Test Long Render', persona: 'test', body: longBody.slice(0, 300) },
    });

    const contact = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: {
        firstName: 'Alexandrovich',
        lastName: 'Doe',
        company: 'SuperLongCompanyName International Corporation LLC',
      },
    });
    const contactId = contact.json().data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/templates/${tmpl.id}/render`,
      payload: { contactId },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.characterCount).toBeGreaterThan(0);
    expect(typeof res.json().data.exceeds300).toBe('boolean');
  });

  it('returns 404 for non-existent contact', async () => {
    const tmpl = await prisma.template.create({
      data: { name: 'Test No Contact', persona: 'test', body: 'Hi {{first_name}}' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/templates/${tmpl.id}/render`,
      payload: { contactId: '00000000-0000-0000-0000-000000000000' },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/templates/:id/preview', () => {
  it('renders template with sample data', async () => {
    const tmpl = await prisma.template.create({
      data: {
        name: 'Test Preview',
        persona: 'crypto',
        body: 'Hey {{first_name}}, love your work on {{recent_post}} at {{company}}!',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/templates/${tmpl.id}/preview`,
      payload: {
        first_name: 'Charlie',
        company: 'CoinBase',
        recent_post: 'DeFi regulations',
      },
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.rendered).toBe('Hey Charlie, love your work on DeFi regulations at CoinBase!');
    expect(data.characterCount).toBeGreaterThan(0);
    expect(data.exceeds300).toBe(false);
  });

  it('replaces missing preview data with empty string', async () => {
    const tmpl = await prisma.template.create({
      data: {
        name: 'Test Preview Missing',
        persona: 'test',
        body: 'Hi {{first_name}} from {{company}}.',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/templates/${tmpl.id}/preview`,
      payload: { first_name: 'Dave' },
    });

    expect(res.json().data.rendered).toBe('Hi Dave from .');
  });

  it('returns 404 for non-existent template', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates/00000000-0000-0000-0000-000000000000/preview',
      payload: { first_name: 'Test' },
    });

    expect(res.statusCode).toBe(404);
  });
});
