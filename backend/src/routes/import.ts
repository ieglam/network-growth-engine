import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import multipart from '@fastify/multipart';
import { prisma } from '../lib/prisma.js';

interface LinkedInRow {
  'First Name'?: string;
  'Last Name'?: string;
  URL?: string;
  'Email Address'?: string;
  Company?: string;
  Position?: string;
  'Connected On'?: string;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    rows.push(row);
  }

  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }

  result.push(current.trim());
  return result;
}

function normalizeLinkedInUrl(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  // Remove trailing slashes for consistent matching
  return trimmed.replace(/\/+$/, '');
}

export async function importRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  await fastify.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  });

  // POST /api/import/linkedin — Import LinkedIn CSV export
  fastify.post('/import/linkedin', async (request, reply) => {
    const file = await request.file();

    if (!file) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'NO_FILE',
          message: 'No file uploaded. Send a CSV file as multipart form data.',
        },
      });
    }

    if (
      file.mimetype !== 'text/csv' &&
      file.mimetype !== 'application/vnd.ms-excel' &&
      !file.filename.endsWith('.csv')
    ) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_FILE_TYPE',
          message: 'File must be a CSV file.',
        },
      });
    }

    const buffer = await file.toBuffer();
    const text = buffer.toString('utf-8');
    const rows = parseCSV(text);

    if (rows.length === 0) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'EMPTY_FILE',
          message: 'CSV file is empty or has no data rows.',
        },
      });
    }

    // Ensure "Uncategorized" category exists
    const uncategorizedCategory = await prisma.category.upsert({
      where: { name: 'Uncategorized' },
      update: {},
      create: { name: 'Uncategorized', relevanceWeight: 1 },
    });

    // Fetch existing LinkedIn URLs for duplicate detection
    const existingByUrl = new Map<string, string>();
    const existingContacts = await prisma.contact.findMany({
      where: { linkedinUrl: { not: null }, deletedAt: null },
      select: { id: true, linkedinUrl: true },
    });
    for (const c of existingContacts) {
      if (c.linkedinUrl) {
        const normalized = normalizeLinkedInUrl(c.linkedinUrl);
        if (normalized) existingByUrl.set(normalized, c.id);
      }
    }

    // Fetch existing name+company combos for fuzzy duplicate flagging
    const existingByNameCompany = new Set<string>();
    const allContacts = await prisma.contact.findMany({
      where: { deletedAt: null },
      select: { firstName: true, lastName: true, company: true },
    });
    for (const c of allContacts) {
      const key =
        `${c.firstName.toLowerCase()}|${c.lastName.toLowerCase()}|${(c.company || '').toLowerCase()}`.trim();
      existingByNameCompany.add(key);
    }

    let imported = 0;
    let duplicatesSkipped = 0;
    const flaggedForReview: {
      firstName: string;
      lastName: string;
      company: string;
      reason: string;
    }[] = [];
    const errors: { row: number; message: string }[] = [];

    // Track URLs seen in this import batch to handle intra-file duplicates
    const seenUrlsInBatch = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as LinkedInRow;
      const firstName = (row['First Name'] || '').trim();
      const lastName = (row['Last Name'] || '').trim();

      if (!firstName || !lastName) {
        errors.push({
          row: i + 2, // +2 for 1-indexed + header row
          message: 'Missing first name or last name',
        });
        continue;
      }

      const linkedinUrl = normalizeLinkedInUrl(row['URL'] || '');
      const email = (row['Email Address'] || '').trim() || null;
      const company = (row['Company'] || '').trim() || null;
      const title = (row['Position'] || '').trim() || null;

      // Duplicate detection: LinkedIn URL exact match
      if (linkedinUrl) {
        if (existingByUrl.has(linkedinUrl) || seenUrlsInBatch.has(linkedinUrl)) {
          duplicatesSkipped++;
          continue;
        }
        seenUrlsInBatch.add(linkedinUrl);
      }

      // Duplicate detection: name + company (flag for review, still import)
      if (company) {
        const nameCompanyKey = `${firstName.toLowerCase()}|${lastName.toLowerCase()}|${company.toLowerCase()}`;
        if (existingByNameCompany.has(nameCompanyKey)) {
          flaggedForReview.push({
            firstName,
            lastName,
            company,
            reason: 'Name + company match found in existing contacts',
          });
        }
      }

      try {
        const contact = await prisma.contact.create({
          data: {
            firstName,
            lastName,
            linkedinUrl,
            email,
            company,
            title,
            status: 'connected',
            fieldSources: {
              firstName: 'linkedin',
              lastName: 'linkedin',
              ...(linkedinUrl ? { linkedinUrl: 'linkedin' } : {}),
              ...(email ? { email: 'linkedin' } : {}),
              ...(company ? { company: 'linkedin' } : {}),
              ...(title ? { title: 'linkedin' } : {}),
            },
          },
        });

        // Assign "Uncategorized" category
        await prisma.contactCategory.create({
          data: {
            contactId: contact.id,
            categoryId: uncategorizedCategory.id,
          },
        });

        // Track new contact for intra-import duplicate detection
        if (linkedinUrl) {
          existingByUrl.set(linkedinUrl, contact.id);
        }
        const nameKey = `${firstName.toLowerCase()}|${lastName.toLowerCase()}|${(company || '').toLowerCase()}`;
        existingByNameCompany.add(nameKey);

        imported++;
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('Unique constraint failed')) {
          duplicatesSkipped++;
        } else {
          errors.push({
            row: i + 2,
            message: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }

    return reply.status(200).send({
      success: true,
      data: {
        imported,
        duplicatesSkipped,
        flaggedForReview,
        errors,
        totalRows: rows.length,
      },
    });
  });
}
