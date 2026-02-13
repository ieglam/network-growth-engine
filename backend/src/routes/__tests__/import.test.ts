import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { importRoutes } from '../import.js';
import { contactRoutes } from '../contacts.js';
import { prisma } from '../../lib/prisma.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(contactRoutes, { prefix: '/api' });
  await app.register(importRoutes, { prefix: '/api' });
  await app.ready();
});

afterAll(async () => {
  await prisma.contactCategory.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.category.deleteMany({ where: { name: 'Uncategorized' } });
  await prisma.$disconnect();
  await app.close();
});

beforeEach(async () => {
  await prisma.contactCategory.deleteMany();
  await prisma.contact.deleteMany();
});

function buildCSV(headers: string[], rows: string[][]): string {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(row.map((v) => (v.includes(',') ? `"${v}"` : v)).join(','));
  }
  return lines.join('\n');
}

function createFormData(csv: string, filename = 'connections.csv') {
  const boundary = '----FormBoundary' + Date.now();
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: text/csv\r\n\r\n` +
    csv +
    `\r\n--${boundary}--\r\n`;
  return { body, boundary };
}

describe('POST /api/import/linkedin', () => {
  it('imports contacts from LinkedIn CSV', async () => {
    const csv = buildCSV(
      ['First Name', 'Last Name', 'URL', 'Email Address', 'Company', 'Position', 'Connected On'],
      [
        [
          'John',
          'Doe',
          'https://linkedin.com/in/johndoe',
          'john@example.com',
          'Acme Corp',
          'Engineer',
          '01 Jan 2024',
        ],
        [
          'Jane',
          'Smith',
          'https://linkedin.com/in/janesmith',
          '',
          'Tech Inc',
          'VP Sales',
          '15 Feb 2024',
        ],
      ]
    );

    const { body, boundary } = createFormData(csv);

    const res = await app.inject({
      method: 'POST',
      url: '/api/import/linkedin',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    const result = res.json();
    expect(result.success).toBe(true);
    expect(result.data.imported).toBe(2);
    expect(result.data.duplicatesSkipped).toBe(0);
    expect(result.data.errors).toHaveLength(0);
    expect(result.data.totalRows).toBe(2);

    // Verify contacts were created with correct status
    const contacts = await prisma.contact.findMany({
      include: { categories: { include: { category: true } } },
    });
    expect(contacts).toHaveLength(2);

    const john = contacts.find((c) => c.firstName === 'John')!;
    expect(john.status).toBe('connected');
    expect(john.company).toBe('Acme Corp');
    expect(john.title).toBe('Engineer');
    expect(john.linkedinUrl).toBe('https://linkedin.com/in/johndoe');
    expect(john.categories).toHaveLength(1);
    expect(john.categories[0].category.name).toBe('Uncategorized');
    expect(john.fieldSources).toMatchObject({
      firstName: 'linkedin',
      lastName: 'linkedin',
      linkedinUrl: 'linkedin',
      company: 'linkedin',
      title: 'linkedin',
    });
  });

  it('skips duplicates by LinkedIn URL', async () => {
    // Create existing contact with same LinkedIn URL
    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: {
        firstName: 'Existing',
        lastName: 'Contact',
        linkedinUrl: 'https://linkedin.com/in/johndoe',
      },
    });

    const csv = buildCSV(
      ['First Name', 'Last Name', 'URL', 'Email Address', 'Company', 'Position'],
      [
        [
          'John',
          'Doe',
          'https://linkedin.com/in/johndoe',
          'john@example.com',
          'Acme Corp',
          'Engineer',
        ],
        ['Jane', 'Smith', 'https://linkedin.com/in/janesmith', '', 'Tech Inc', 'VP Sales'],
      ]
    );

    const { body, boundary } = createFormData(csv);

    const res = await app.inject({
      method: 'POST',
      url: '/api/import/linkedin',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    const result = res.json();
    expect(result.data.imported).toBe(1);
    expect(result.data.duplicatesSkipped).toBe(1);
  });

  it('is idempotent - re-upload same file creates no new records', async () => {
    const csv = buildCSV(
      ['First Name', 'Last Name', 'URL', 'Email Address', 'Company', 'Position'],
      [
        [
          'John',
          'Doe',
          'https://linkedin.com/in/johndoe',
          'john@example.com',
          'Acme Corp',
          'Engineer',
        ],
      ]
    );

    const { body, boundary } = createFormData(csv);
    const headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };

    // First import
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/import/linkedin',
      headers,
      payload: body,
    });
    expect(res1.json().data.imported).toBe(1);

    // Second import — same file
    const { body: body2, boundary: boundary2 } = createFormData(csv);
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/import/linkedin',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary2}` },
      payload: body2,
    });
    expect(res2.json().data.imported).toBe(0);
    expect(res2.json().data.duplicatesSkipped).toBe(1);

    // Verify only 1 contact exists
    const count = await prisma.contact.count();
    expect(count).toBe(1);
  });

  it('flags name + company duplicates for review', async () => {
    // Create existing contact
    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: {
        firstName: 'John',
        lastName: 'Doe',
        company: 'Acme Corp',
      },
    });

    // Import a different person with same name+company but different URL
    const csv = buildCSV(
      ['First Name', 'Last Name', 'URL', 'Email Address', 'Company', 'Position'],
      [
        [
          'John',
          'Doe',
          'https://linkedin.com/in/johndoe2',
          'john2@example.com',
          'Acme Corp',
          'Manager',
        ],
      ]
    );

    const { body, boundary } = createFormData(csv);

    const res = await app.inject({
      method: 'POST',
      url: '/api/import/linkedin',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    const result = res.json();
    expect(result.data.imported).toBe(1);
    expect(result.data.flaggedForReview).toHaveLength(1);
    expect(result.data.flaggedForReview[0].reason).toContain('Name + company match');
  });

  it('reports errors for rows with missing required fields', async () => {
    const csv = buildCSV(
      ['First Name', 'Last Name', 'URL', 'Email Address', 'Company', 'Position'],
      [
        ['John', '', 'https://linkedin.com/in/johndoe', '', 'Acme', 'Engineer'],
        ['', 'Smith', 'https://linkedin.com/in/janesmith', '', 'Tech', 'VP'],
        ['Valid', 'Contact', 'https://linkedin.com/in/valid', '', 'Corp', 'CTO'],
      ]
    );

    const { body, boundary } = createFormData(csv);

    const res = await app.inject({
      method: 'POST',
      url: '/api/import/linkedin',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    const result = res.json();
    expect(result.data.imported).toBe(1);
    expect(result.data.errors).toHaveLength(2);
  });

  it('rejects request with no file', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/linkedin',
      headers: {
        'content-type': 'multipart/form-data; boundary=----empty',
      },
      payload: '------empty--\r\n',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('NO_FILE');
  });

  it('rejects empty CSV', async () => {
    const csv = 'First Name,Last Name,URL\n';
    const { body, boundary } = createFormData(csv);

    const res = await app.inject({
      method: 'POST',
      url: '/api/import/linkedin',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('EMPTY_FILE');
  });

  it('handles intra-file duplicate URLs', async () => {
    const csv = buildCSV(
      ['First Name', 'Last Name', 'URL', 'Email Address', 'Company', 'Position'],
      [
        ['John', 'Doe', 'https://linkedin.com/in/johndoe', '', 'Acme', 'Engineer'],
        ['John', 'Doe', 'https://linkedin.com/in/johndoe', '', 'Acme', 'Engineer'],
      ]
    );

    const { body, boundary } = createFormData(csv);

    const res = await app.inject({
      method: 'POST',
      url: '/api/import/linkedin',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    const result = res.json();
    expect(result.data.imported).toBe(1);
    expect(result.data.duplicatesSkipped).toBe(1);
  });
});

function createMultipartWithMapping(
  csv: string,
  mapping: Record<string, string>,
  filename = 'data.csv'
) {
  const boundary = '----FormBoundary' + Date.now();
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: text/csv\r\n\r\n` +
    csv +
    `\r\n--${boundary}\r\n` +
    `Content-Disposition: form-data; name="mapping"\r\n\r\n` +
    JSON.stringify(mapping) +
    `\r\n--${boundary}--\r\n`;
  return { body, boundary };
}

describe('POST /api/import/csv/preview', () => {
  it('returns headers and sample rows', async () => {
    const csv = buildCSV(
      ['Name', 'Company', 'Role', 'Email'],
      [
        ['John Doe', 'Acme', 'Engineer', 'john@acme.com'],
        ['Jane Smith', 'Tech', 'VP', 'jane@tech.com'],
        ['Bob Brown', 'Corp', 'CTO', 'bob@corp.com'],
      ]
    );

    const { body, boundary } = createFormData(csv);

    const res = await app.inject({
      method: 'POST',
      url: '/api/import/csv/preview',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    const result = res.json();
    expect(result.data.headers).toEqual(['Name', 'Company', 'Role', 'Email']);
    expect(result.data.sampleRows).toHaveLength(3);
    expect(result.data.totalRows).toBe(3);
  });

  it('returns at most 3 sample rows', async () => {
    const csv = buildCSV(
      ['Col1', 'Col2'],
      [
        ['a', 'b'],
        ['c', 'd'],
        ['e', 'f'],
        ['g', 'h'],
        ['i', 'j'],
      ]
    );

    const { body, boundary } = createFormData(csv);

    const res = await app.inject({
      method: 'POST',
      url: '/api/import/csv/preview',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.json().data.sampleRows).toHaveLength(3);
    expect(res.json().data.totalRows).toBe(5);
  });

  it('rejects empty CSV', async () => {
    const { body, boundary } = createFormData('');

    const res = await app.inject({
      method: 'POST',
      url: '/api/import/csv/preview',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/import/csv', () => {
  it('imports contacts with column mapping', async () => {
    const csv = buildCSV(
      ['First', 'Last', 'Organization', 'Role'],
      [
        ['John', 'Doe', 'Acme Corp', 'Engineer'],
        ['Jane', 'Smith', 'Tech Inc', 'VP Sales'],
      ]
    );

    const mapping = {
      firstName: 'First',
      lastName: 'Last',
      company: 'Organization',
      title: 'Role',
    };

    const { body, boundary } = createMultipartWithMapping(csv, mapping);

    const res = await app.inject({
      method: 'POST',
      url: '/api/import/csv',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    const result = res.json();
    expect(result.data.imported).toBe(2);
    expect(result.data.totalRows).toBe(2);

    // Verify default status is "target"
    const contacts = await prisma.contact.findMany();
    expect(contacts).toHaveLength(2);
    expect(contacts.every((c) => c.status === 'target')).toBe(true);
  });

  it('assigns category from mapped column', async () => {
    const csv = buildCSV(['First', 'Last', 'Cat'], [['John', 'Doe', 'VIP Contacts']]);

    const mapping = {
      firstName: 'First',
      lastName: 'Last',
      category: 'Cat',
    };

    const { body, boundary } = createMultipartWithMapping(csv, mapping);

    const res = await app.inject({
      method: 'POST',
      url: '/api/import/csv',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.json().data.imported).toBe(1);

    const contact = await prisma.contact.findFirst({
      include: { categories: { include: { category: true } } },
    });
    expect(contact!.categories).toHaveLength(1);
    expect(contact!.categories[0].category.name).toBe('VIP Contacts');

    // Cleanup created category
    await prisma.contactCategory.deleteMany();
    await prisma.category.deleteMany({ where: { name: 'VIP Contacts' } });
  });

  it('skips duplicates by LinkedIn URL', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: {
        firstName: 'Existing',
        lastName: 'Contact',
        linkedinUrl: 'https://linkedin.com/in/existing',
      },
    });

    const csv = buildCSV(
      ['First', 'Last', 'LinkedIn'],
      [
        ['John', 'Doe', 'https://linkedin.com/in/existing'],
        ['Jane', 'Smith', 'https://linkedin.com/in/newperson'],
      ]
    );

    const mapping = { firstName: 'First', lastName: 'Last', linkedinUrl: 'LinkedIn' };
    const { body, boundary } = createMultipartWithMapping(csv, mapping);

    const res = await app.inject({
      method: 'POST',
      url: '/api/import/csv',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.json().data.imported).toBe(1);
    expect(res.json().data.duplicatesSkipped).toBe(1);
  });

  it('skips name+company duplicates without URL', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { firstName: 'John', lastName: 'Doe', company: 'Acme Corp' },
    });

    const csv = buildCSV(['First', 'Last', 'Org'], [['John', 'Doe', 'Acme Corp']]);

    const mapping = { firstName: 'First', lastName: 'Last', company: 'Org' };
    const { body, boundary } = createMultipartWithMapping(csv, mapping);

    const res = await app.inject({
      method: 'POST',
      url: '/api/import/csv',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.json().data.imported).toBe(0);
    expect(res.json().data.duplicatesSkipped).toBe(1);
  });

  it('ignores unmapped columns without error', async () => {
    const csv = buildCSV(
      ['First', 'Last', 'ExtraCol1', 'ExtraCol2', 'Secret'],
      [['John', 'Doe', 'ignored', 'also ignored', 'skip this']]
    );

    const mapping = { firstName: 'First', lastName: 'Last' };
    const { body, boundary } = createMultipartWithMapping(csv, mapping);

    const res = await app.inject({
      method: 'POST',
      url: '/api/import/csv',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.json().data.imported).toBe(1);
    expect(res.json().data.errors).toHaveLength(0);
  });

  it('rejects missing mapping', async () => {
    const csv = buildCSV(['First', 'Last'], [['John', 'Doe']]);
    const { body, boundary } = createFormData(csv);

    const res = await app.inject({
      method: 'POST',
      url: '/api/import/csv',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('NO_MAPPING');
  });

  it('rejects invalid mapping (missing required fields)', async () => {
    const csv = buildCSV(['Col1'], [['data']]);
    const mapping = { company: 'Col1' }; // missing firstName and lastName

    const { body, boundary } = createMultipartWithMapping(csv, mapping);

    const res = await app.inject({
      method: 'POST',
      url: '/api/import/csv',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_MAPPING');
  });

  it('supports CSV without LinkedIn URLs (name minimum)', async () => {
    const csv = buildCSV(
      ['Given Name', 'Family Name'],
      [
        ['Alice', 'Alpha'],
        ['Bob', 'Beta'],
      ]
    );

    const mapping = { firstName: 'Given Name', lastName: 'Family Name' };
    const { body, boundary } = createMultipartWithMapping(csv, mapping);

    const res = await app.inject({
      method: 'POST',
      url: '/api/import/csv',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.json().data.imported).toBe(2);
    expect(res.json().data.errors).toHaveLength(0);
  });
});
