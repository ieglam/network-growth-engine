import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { calculateContactScore, loadScoringConfig } from '../services/scoringService.js';
import { checkStatusTransition, checkDemotion } from '../services/statusTransitionService.js';

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

  // POST /api/import/csv/preview — Return CSV headers and sample rows for mapping
  fastify.post('/import/csv/preview', async (request, reply) => {
    const file = await request.file();

    if (!file) {
      return reply.status(400).send({
        success: false,
        error: { code: 'NO_FILE', message: 'No file uploaded.' },
      });
    }

    if (!file.filename.endsWith('.csv') && file.mimetype !== 'text/csv') {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_FILE_TYPE', message: 'File must be a CSV file.' },
      });
    }

    const buffer = await file.toBuffer();
    const text = buffer.toString('utf-8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());

    if (lines.length === 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'EMPTY_FILE', message: 'CSV file is empty.' },
      });
    }

    const headers = parseCSVLine(lines[0]);
    const sampleRows: string[][] = [];
    for (let i = 1; i < Math.min(lines.length, 4); i++) {
      sampleRows.push(parseCSVLine(lines[i]));
    }

    return {
      success: true,
      data: {
        headers,
        sampleRows,
        totalRows: lines.length - 1,
      },
    };
  });

  // POST /api/import/csv — Import generic CSV with column mapping
  const columnMappingSchema = z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    company: z.string().optional(),
    title: z.string().optional(),
    linkedinUrl: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    location: z.string().optional(),
    notes: z.string().optional(),
    category: z.string().optional(),
  });

  fastify.post('/import/csv', async (request, reply) => {
    const parts = request.parts();
    let csvText: string | null = null;
    let mappingJson: string | null = null;

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'file') {
        const buffer = await part.toBuffer();
        csvText = buffer.toString('utf-8');
      } else if (part.type === 'field' && part.fieldname === 'mapping') {
        mappingJson = part.value as string;
      }
    }

    if (!csvText) {
      return reply.status(400).send({
        success: false,
        error: { code: 'NO_FILE', message: 'No CSV file uploaded.' },
      });
    }

    if (!mappingJson) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'NO_MAPPING',
          message: 'Column mapping is required. Send a "mapping" field with JSON.',
        },
      });
    }

    let mapping: z.infer<typeof columnMappingSchema>;
    try {
      mapping = columnMappingSchema.parse(JSON.parse(mappingJson));
    } catch {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_MAPPING',
          message: 'Invalid column mapping. firstName and lastName are required.',
        },
      });
    }

    const rows = parseCSV(csvText);
    if (rows.length === 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'EMPTY_FILE', message: 'CSV file has no data rows.' },
      });
    }

    // Build duplicate detection sets
    const existingByUrl = new Map<string, string>();
    const urlContacts = await prisma.contact.findMany({
      where: { linkedinUrl: { not: null }, deletedAt: null },
      select: { id: true, linkedinUrl: true },
    });
    for (const c of urlContacts) {
      if (c.linkedinUrl) {
        const normalized = normalizeLinkedInUrl(c.linkedinUrl);
        if (normalized) existingByUrl.set(normalized, c.id);
      }
    }

    const existingByNameCompany = new Set<string>();
    const allContacts = await prisma.contact.findMany({
      where: { deletedAt: null },
      select: { firstName: true, lastName: true, company: true },
    });
    for (const c of allContacts) {
      existingByNameCompany.add(
        `${c.firstName.toLowerCase()}|${c.lastName.toLowerCase()}|${(c.company || '').toLowerCase()}`
      );
    }

    // Resolve category if mapped
    let categoryId: string | null = null;
    const categoryNames = new Map<string, string>();
    if (mapping.category) {
      const existingCategories = await prisma.category.findMany({
        select: { id: true, name: true },
      });
      for (const cat of existingCategories) {
        categoryNames.set(cat.name.toLowerCase(), cat.id);
      }
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
    const seenUrlsInBatch = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const firstName = (row[mapping.firstName] || '').trim();
      const lastName = (row[mapping.lastName] || '').trim();

      if (!firstName || !lastName) {
        errors.push({ row: i + 2, message: 'Missing first name or last name' });
        continue;
      }

      const linkedinUrl = mapping.linkedinUrl
        ? normalizeLinkedInUrl(row[mapping.linkedinUrl] || '')
        : null;
      const email = mapping.email ? (row[mapping.email] || '').trim() || null : null;
      const company = mapping.company ? (row[mapping.company] || '').trim() || null : null;
      const title = mapping.title ? (row[mapping.title] || '').trim() || null : null;
      const phone = mapping.phone ? (row[mapping.phone] || '').trim() || null : null;
      const location = mapping.location ? (row[mapping.location] || '').trim() || null : null;
      const notes = mapping.notes ? (row[mapping.notes] || '').trim() || null : null;
      const rowCategory = mapping.category ? (row[mapping.category] || '').trim() || null : null;

      // Duplicate detection: LinkedIn URL
      if (linkedinUrl) {
        if (existingByUrl.has(linkedinUrl) || seenUrlsInBatch.has(linkedinUrl)) {
          duplicatesSkipped++;
          continue;
        }
        seenUrlsInBatch.add(linkedinUrl);
      }

      // Duplicate detection: name + company
      if (company) {
        const key = `${firstName.toLowerCase()}|${lastName.toLowerCase()}|${company.toLowerCase()}`;
        if (existingByNameCompany.has(key)) {
          if (!linkedinUrl) {
            // No URL to distinguish — skip as duplicate
            duplicatesSkipped++;
            continue;
          }
          flaggedForReview.push({
            firstName,
            lastName,
            company,
            reason: 'Name + company match found in existing contacts',
          });
        }
      }

      // Build field sources
      const fieldSources: Record<string, string> = {
        firstName: 'manual',
        lastName: 'manual',
      };
      if (linkedinUrl) fieldSources.linkedinUrl = 'manual';
      if (email) fieldSources.email = 'manual';
      if (company) fieldSources.company = 'manual';
      if (title) fieldSources.title = 'manual';
      if (phone) fieldSources.phone = 'manual';
      if (location) fieldSources.location = 'manual';
      if (notes) fieldSources.notes = 'manual';

      try {
        const contact = await prisma.contact.create({
          data: {
            firstName,
            lastName,
            linkedinUrl,
            email,
            company,
            title,
            phone,
            location,
            notes,
            status: 'target',
            fieldSources,
          },
        });

        // Assign category if provided in the row
        if (rowCategory) {
          const catKey = rowCategory.toLowerCase();
          if (!categoryNames.has(catKey)) {
            const newCat = await prisma.category.create({
              data: { name: rowCategory, relevanceWeight: 3 },
            });
            categoryNames.set(catKey, newCat.id);
          }
          categoryId = categoryNames.get(catKey)!;
          await prisma.contactCategory.create({
            data: { contactId: contact.id, categoryId },
          });
        }

        if (linkedinUrl) existingByUrl.set(linkedinUrl, contact.id);
        existingByNameCompany.add(
          `${firstName.toLowerCase()}|${lastName.toLowerCase()}|${(company || '').toLowerCase()}`
        );

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

  // ─── LinkedIn Messages Import ───────────────────────────────────────────────

  const MESSAGE_POINTS: Record<string, number> = {
    linkedin_dm_sent: 2,
    linkedin_dm_received: 3,
  };

  // POST /api/import/linkedin-messages — Import LinkedIn messages.csv
  fastify.post('/import/linkedin-messages', async (request, reply) => {
    const file = await request.file();

    if (!file) {
      return reply.status(400).send({
        success: false,
        error: { code: 'NO_FILE', message: 'No file uploaded.' },
      });
    }

    if (!file.filename.endsWith('.csv')) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_FILE_TYPE', message: 'File must be a CSV file.' },
      });
    }

    const buffer = await file.toBuffer();
    const text = buffer.toString('utf-8');
    const rows = parseCSV(text);

    if (rows.length === 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'EMPTY_FILE', message: 'CSV file is empty or has no data rows.' },
      });
    }

    // Validate expected columns
    const firstRow = rows[0];
    const hasRequiredColumns =
      'FROM' in firstRow && 'SENDER PROFILE URL' in firstRow && 'DATE' in firstRow;
    if (!hasRequiredColumns) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_FORMAT',
          message:
            'CSV must have columns: FROM, SENDER PROFILE URL, DATE. Expected LinkedIn messages.csv format.',
        },
      });
    }

    // Auto-detect user's LinkedIn profile URL (most frequent sender)
    const senderUrlCounts = new Map<string, number>();
    for (const row of rows) {
      const senderUrl = normalizeLinkedInUrl((row['SENDER PROFILE URL'] || '').trim());
      if (senderUrl) {
        senderUrlCounts.set(senderUrl, (senderUrlCounts.get(senderUrl) || 0) + 1);
      }
    }

    let userLinkedinUrl: string | null = null;
    let maxCount = 0;
    for (const [url, count] of senderUrlCounts) {
      if (count > maxCount) {
        maxCount = count;
        userLinkedinUrl = url;
      }
    }

    // Also check settings for user's LinkedIn URL
    const userUrlSetting = await prisma.settings.findUnique({
      where: { key: 'user_linkedin_url' },
    });
    if (userUrlSetting?.value) {
      userLinkedinUrl = normalizeLinkedInUrl(userUrlSetting.value) || userLinkedinUrl;
    }

    if (!userLinkedinUrl) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'CANNOT_DETECT_USER',
          message:
            'Could not determine your LinkedIn profile URL. Add user_linkedin_url in Settings.',
        },
      });
    }

    // Build lookup maps: LinkedIn URL → contact, and name → contacts
    const contactsByUrl = new Map<string, { id: string; lastInteractionAt: Date | null }>();
    const contactsByName = new Map<
      string,
      { id: string; lastInteractionAt: Date | null; firstName: string; lastName: string }[]
    >();

    const allContacts = await prisma.contact.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        linkedinUrl: true,
        lastInteractionAt: true,
      },
    });

    for (const c of allContacts) {
      if (c.linkedinUrl) {
        const normalized = normalizeLinkedInUrl(c.linkedinUrl);
        if (normalized) {
          contactsByUrl.set(normalized, {
            id: c.id,
            lastInteractionAt: c.lastInteractionAt,
          });
        }
      }
      const nameKey = `${c.firstName.toLowerCase()} ${c.lastName.toLowerCase()}`;
      if (!contactsByName.has(nameKey)) {
        contactsByName.set(nameKey, []);
      }
      contactsByName.get(nameKey)!.push({
        id: c.id,
        lastInteractionAt: c.lastInteractionAt,
        firstName: c.firstName,
        lastName: c.lastName,
      });
    }

    // Fetch existing interactions for deduplication
    const existingInteractions = new Set<string>();
    const allInteractions = await prisma.interaction.findMany({
      where: {
        type: { in: ['linkedin_dm_sent', 'linkedin_dm_received'] },
      },
      select: { contactId: true, occurredAt: true },
    });
    for (const i of allInteractions) {
      existingInteractions.add(`${i.contactId}|${i.occurredAt.toISOString()}`);
    }

    let totalParsed = 0;
    let matched = 0;
    let interactionsCreated = 0;
    let unmatchedSkipped = 0;
    let duplicatesSkipped = 0;
    const affectedContactIds = new Set<string>();
    const contactLastDates = new Map<string, Date>();
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      totalParsed++;

      const from = (row['FROM'] || '').trim();
      const senderProfileUrl = normalizeLinkedInUrl((row['SENDER PROFILE URL'] || '').trim());
      const dateStr = (row['DATE'] || '').trim();
      const content = (row['CONTENT'] || '').trim();
      const subject = (row['SUBJECT'] || '').trim();
      const conversationId = (row['CONVERSATION ID'] || '').trim();

      if (!dateStr) {
        errors.push({ row: i + 2, message: 'Missing DATE field' });
        continue;
      }

      const occurredAt = new Date(dateStr);
      if (isNaN(occurredAt.getTime())) {
        errors.push({ row: i + 2, message: `Invalid date: ${dateStr}` });
        continue;
      }

      // Determine direction
      const isOutbound = senderProfileUrl === userLinkedinUrl;

      // For outbound messages, the other person is the conversation partner (we need to find them)
      // For inbound messages, the sender IS the other person
      let contactId: string | null = null;

      if (isOutbound) {
        // Outbound: we need to find the recipient. LinkedIn messages.csv doesn't have recipient URL.
        // Use CONVERSATION TITLE which is typically the other person's name
        const conversationTitle = (row['CONVERSATION TITLE'] || '').trim();
        if (conversationTitle) {
          const titleLower = conversationTitle.toLowerCase();
          const nameMatches = contactsByName.get(titleLower);
          if (nameMatches && nameMatches.length === 1) {
            contactId = nameMatches[0].id;
          } else if (nameMatches && nameMatches.length > 1) {
            // Multiple matches — use the first one
            contactId = nameMatches[0].id;
          }
        }
      } else {
        // Inbound: match sender by URL first, then by name
        if (senderProfileUrl) {
          const urlMatch = contactsByUrl.get(senderProfileUrl);
          if (urlMatch) {
            contactId = urlMatch.id;
          }
        }
        if (!contactId && from) {
          const fromLower = from.toLowerCase();
          const nameMatches = contactsByName.get(fromLower);
          if (nameMatches && nameMatches.length >= 1) {
            contactId = nameMatches[0].id;
          }
        }
      }

      if (!contactId) {
        unmatchedSkipped++;
        continue;
      }

      matched++;

      // Deduplication: same contact + same timestamp
      const dedupeKey = `${contactId}|${occurredAt.toISOString()}`;
      if (existingInteractions.has(dedupeKey)) {
        duplicatesSkipped++;
        continue;
      }
      existingInteractions.add(dedupeKey);

      const interactionType = isOutbound ? 'linkedin_dm_sent' : 'linkedin_dm_received';
      const pointsValue = MESSAGE_POINTS[interactionType as keyof typeof MESSAGE_POINTS] || 0;

      try {
        await prisma.interaction.create({
          data: {
            contactId,
            type: interactionType,
            source: 'linkedin',
            occurredAt,
            pointsValue,
            metadata: {
              ...(content ? { content } : {}),
              ...(subject ? { subject } : {}),
              ...(conversationId ? { conversationId } : {}),
              senderName: from,
            },
          },
        });
        interactionsCreated++;
        affectedContactIds.add(contactId);

        // Track latest date per contact
        const existing = contactLastDates.get(contactId);
        if (!existing || occurredAt > existing) {
          contactLastDates.set(contactId, occurredAt);
        }
      } catch (err) {
        errors.push({
          row: i + 2,
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    // Update last_interaction_at for affected contacts
    for (const [cId, lastDate] of contactLastDates) {
      const contact = await prisma.contact.findUnique({
        where: { id: cId },
        select: { lastInteractionAt: true },
      });
      if (!contact?.lastInteractionAt || lastDate > contact.lastInteractionAt) {
        await prisma.contact.update({
          where: { id: cId },
          data: { lastInteractionAt: lastDate },
        });
      }
    }

    // Recalculate scores for affected contacts
    let scoresRecalculated = 0;
    if (affectedContactIds.size > 0) {
      const config = await loadScoringConfig();
      const now = new Date();
      for (const cId of affectedContactIds) {
        const newScore = await calculateContactScore(cId, config, now);
        await prisma.contact.update({
          where: { id: cId },
          data: { relationshipScore: newScore },
        });
        await checkStatusTransition(cId);
        await checkDemotion(cId);
        scoresRecalculated++;
      }
    }

    // Save detected user URL to settings if not already there
    if (!userUrlSetting && userLinkedinUrl) {
      await prisma.settings.create({
        data: { key: 'user_linkedin_url', value: userLinkedinUrl },
      });
    }

    return reply.status(200).send({
      success: true,
      data: {
        totalParsed,
        matched,
        interactionsCreated,
        unmatchedSkipped,
        duplicatesSkipped,
        errors,
        scoresRecalculated,
        userLinkedinUrl,
      },
    });
  });

  // ─── LinkedIn Invitations Import ────────────────────────────────────────────

  const INVITATION_POINTS: Record<string, number> = {
    connection_request_sent: 3,
    connection_request_accepted: 5,
  };

  // POST /api/import/linkedin-invitations — Import LinkedIn Invitations.csv
  fastify.post('/import/linkedin-invitations', async (request, reply) => {
    const file = await request.file();

    if (!file) {
      return reply.status(400).send({
        success: false,
        error: { code: 'NO_FILE', message: 'No file uploaded.' },
      });
    }

    if (!file.filename.endsWith('.csv')) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_FILE_TYPE', message: 'File must be a CSV file.' },
      });
    }

    const buffer = await file.toBuffer();
    const text = buffer.toString('utf-8');
    const rows = parseCSV(text);

    if (rows.length === 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'EMPTY_FILE', message: 'CSV file is empty or has no data rows.' },
      });
    }

    // Validate expected columns
    const firstRow = rows[0];
    const hasRequiredColumns =
      'From' in firstRow && 'To' in firstRow && 'Date Sent' in firstRow && 'Direction' in firstRow;
    if (!hasRequiredColumns) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_FORMAT',
          message:
            'CSV must have columns: From, To, Date Sent, Direction. Expected LinkedIn Invitations.csv format.',
        },
      });
    }

    // Build name → contacts lookup
    const contactsByName = new Map<string, { id: string; lastInteractionAt: Date | null }[]>();
    const allContacts = await prisma.contact.findMany({
      where: { deletedAt: null },
      select: { id: true, firstName: true, lastName: true, lastInteractionAt: true },
    });
    for (const c of allContacts) {
      const nameKey = `${c.firstName.toLowerCase()} ${c.lastName.toLowerCase()}`;
      if (!contactsByName.has(nameKey)) {
        contactsByName.set(nameKey, []);
      }
      contactsByName.get(nameKey)!.push({
        id: c.id,
        lastInteractionAt: c.lastInteractionAt,
      });
    }

    // Fetch existing interactions for deduplication
    const existingInteractions = new Set<string>();
    const allInteractions = await prisma.interaction.findMany({
      where: {
        type: { in: ['connection_request_sent', 'connection_request_accepted'] },
      },
      select: { contactId: true, occurredAt: true, type: true },
    });
    for (const i of allInteractions) {
      existingInteractions.add(`${i.contactId}|${i.type}|${i.occurredAt.toISOString()}`);
    }

    let totalParsed = 0;
    let matched = 0;
    let interactionsCreated = 0;
    let unmatchedSkipped = 0;
    let duplicatesSkipped = 0;
    const affectedContactIds = new Set<string>();
    const contactLastDates = new Map<string, Date>();
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      totalParsed++;

      const from = (row['From'] || '').trim();
      const to = (row['To'] || '').trim();
      const dateSent = (row['Date Sent'] || '').trim();
      const message = (row['Message'] || '').trim();
      const direction = (row['Direction'] || '').trim().toUpperCase();

      if (!dateSent) {
        errors.push({ row: i + 2, message: 'Missing Date Sent field' });
        continue;
      }

      const occurredAt = new Date(dateSent);
      if (isNaN(occurredAt.getTime())) {
        errors.push({ row: i + 2, message: `Invalid date: ${dateSent}` });
        continue;
      }

      // Determine interaction type based on direction
      const isOutgoing = direction === 'OUTGOING';
      const interactionType = isOutgoing
        ? 'connection_request_sent'
        : 'connection_request_accepted';

      // Match the other person's name
      const otherPersonName = isOutgoing ? to : from;
      if (!otherPersonName) {
        errors.push({ row: i + 2, message: 'Missing contact name' });
        continue;
      }

      const nameLower = otherPersonName.toLowerCase();
      const nameMatches = contactsByName.get(nameLower);

      if (!nameMatches || nameMatches.length === 0) {
        unmatchedSkipped++;
        continue;
      }

      matched++;
      const contactId = nameMatches[0].id;

      // Deduplication
      const dedupeKey = `${contactId}|${interactionType}|${occurredAt.toISOString()}`;
      if (existingInteractions.has(dedupeKey)) {
        duplicatesSkipped++;
        continue;
      }
      existingInteractions.add(dedupeKey);

      const pointsValue = INVITATION_POINTS[interactionType as keyof typeof INVITATION_POINTS] || 0;

      try {
        await prisma.interaction.create({
          data: {
            contactId,
            type: interactionType,
            source: 'linkedin',
            occurredAt,
            pointsValue,
            metadata: {
              ...(message ? { message } : {}),
              direction,
              from,
              to,
            },
          },
        });
        interactionsCreated++;
        affectedContactIds.add(contactId);

        const existing = contactLastDates.get(contactId);
        if (!existing || occurredAt > existing) {
          contactLastDates.set(contactId, occurredAt);
        }
      } catch (err) {
        errors.push({
          row: i + 2,
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    // Update last_interaction_at for affected contacts
    for (const [cId, lastDate] of contactLastDates) {
      const contact = await prisma.contact.findUnique({
        where: { id: cId },
        select: { lastInteractionAt: true },
      });
      if (!contact?.lastInteractionAt || lastDate > contact.lastInteractionAt) {
        await prisma.contact.update({
          where: { id: cId },
          data: { lastInteractionAt: lastDate },
        });
      }
    }

    // Recalculate scores for affected contacts
    let scoresRecalculated = 0;
    if (affectedContactIds.size > 0) {
      const config = await loadScoringConfig();
      const now = new Date();
      for (const cId of affectedContactIds) {
        const newScore = await calculateContactScore(cId, config, now);
        await prisma.contact.update({
          where: { id: cId },
          data: { relationshipScore: newScore },
        });
        await checkStatusTransition(cId);
        await checkDemotion(cId);
        scoresRecalculated++;
      }
    }

    return reply.status(200).send({
      success: true,
      data: {
        totalParsed,
        matched,
        interactionsCreated,
        unmatchedSkipped,
        duplicatesSkipped,
        errors,
        scoresRecalculated,
      },
    });
  });
}
