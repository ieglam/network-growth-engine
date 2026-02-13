import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

const validStatuses = ['target', 'requested', 'connected', 'engaged', 'relationship'];

const exportQuerySchema = z.object({
  format: z.enum(['csv', 'json']).default('json'),
  status: z.string().optional(),
  category: z.string().optional(),
  tag: z.string().optional(),
  scoreMin: z.coerce.number().int().min(0).max(100).optional(),
  scoreMax: z.coerce.number().int().min(0).max(100).optional(),
  location: z.string().optional(),
  includeInteractions: z.enum(['true', 'false']).optional(),
});

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

const CSV_HEADERS = [
  'id',
  'firstName',
  'lastName',
  'title',
  'company',
  'linkedinUrl',
  'email',
  'phone',
  'location',
  'headline',
  'status',
  'seniority',
  'relationshipScore',
  'priorityScore',
  'notes',
  'introductionSource',
  'lastInteractionAt',
  'categories',
  'tags',
  'createdAt',
];

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function contactToCsvRow(contact: ContactWithRelations): string {
  const cats = contact.categories.map((cc) => cc.category.name).join('; ');
  const tags = contact.tags.map((ct) => ct.tag.name).join('; ');

  const fields = [
    contact.id,
    contact.firstName,
    contact.lastName,
    contact.title,
    contact.company,
    contact.linkedinUrl,
    contact.email,
    contact.phone,
    contact.location,
    contact.headline,
    contact.status,
    contact.seniority,
    contact.relationshipScore,
    contact.priorityScore,
    contact.notes,
    contact.introductionSource,
    contact.lastInteractionAt,
    cats,
    tags,
    contact.createdAt,
  ];

  return fields.map(escapeCsvField).join(',');
}

type ContactWithRelations = Prisma.ContactGetPayload<{
  include: {
    categories: { include: { category: true } };
    tags: { include: { tag: true } };
  };
}>;

function buildExportWhere(query: z.infer<typeof exportQuerySchema>): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = { deletedAt: null };

  if (query.status) {
    const statuses = query.status.split(',').filter((s) => validStatuses.includes(s));
    if (statuses.length > 0) {
      where.status = { in: statuses as Prisma.EnumContactStatusFilter['in'] };
    }
  }

  if (query.scoreMin !== undefined || query.scoreMax !== undefined) {
    where.relationshipScore = {};
    if (query.scoreMin !== undefined) where.relationshipScore.gte = query.scoreMin;
    if (query.scoreMax !== undefined) where.relationshipScore.lte = query.scoreMax;
  }

  if (query.location) {
    where.location = { contains: query.location, mode: 'insensitive' };
  }

  if (query.category) {
    const categoryIds = query.category.split(',');
    where.categories = { some: { categoryId: { in: categoryIds } } };
  }

  if (query.tag) {
    const tagIds = query.tag.split(',');
    where.tags = { some: { tagId: { in: tagIds } } };
  }

  return where;
}

export async function exportRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  // GET /api/export/contacts — Export contacts in CSV or JSON
  fastify.get('/export/contacts', async (request, reply) => {
    const parseResult = exportQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: parseResult.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
        },
      });
    }

    const query = parseResult.data;
    const where = buildExportWhere(query);
    const includeInteractions = query.includeInteractions === 'true';

    const contacts = await prisma.contact.findMany({
      where,
      include: {
        categories: { include: { category: true } },
        tags: { include: { tag: true } },
        ...(includeInteractions
          ? { interactions: { orderBy: { occurredAt: 'desc' as const } } }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    if (query.format === 'csv') {
      const headerRow = CSV_HEADERS.join(',');
      const rows = (contacts as ContactWithRelations[]).map(contactToCsvRow);
      const csv = [headerRow, ...rows].join('\n');

      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header(
          'Content-Disposition',
          `attachment; filename="contacts-export-${new Date().toISOString().slice(0, 10)}.csv"`
        )
        .send(csv);
    }

    // JSON format
    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header(
        'Content-Disposition',
        `attachment; filename="contacts-export-${new Date().toISOString().slice(0, 10)}.json"`
      )
      .send({
        success: true,
        data: {
          exportedAt: new Date().toISOString(),
          count: contacts.length,
          contacts,
        },
      });
  });

  // GET /api/export/contacts/:id — Export single contact (GDPR-style)
  fastify.get('/export/contacts/:id', async (request, reply) => {
    const paramResult = uuidParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid contact ID format' },
      });
    }

    const contact = await prisma.contact.findFirst({
      where: { id: paramResult.data.id, deletedAt: null },
      include: {
        categories: { include: { category: true } },
        tags: { include: { tag: true } },
        interactions: { orderBy: { occurredAt: 'desc' } },
        statusHistory: { orderBy: { createdAt: 'desc' } },
        scoreHistory: { orderBy: { recordedAt: 'desc' } },
      },
    });

    if (!contact) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'CONTACT_NOT_FOUND',
          message: `Contact with ID ${paramResult.data.id} not found`,
        },
      });
    }

    return {
      success: true,
      data: {
        exportedAt: new Date().toISOString(),
        contact,
      },
    };
  });
}
