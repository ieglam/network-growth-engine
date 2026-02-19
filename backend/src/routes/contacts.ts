import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import {
  manualStatusTransition,
  handleConnectionAccepted,
} from '../services/statusTransitionService.js';
import { config } from '../lib/config.js';
import { aiCategorizeContacts } from '../services/aiCategorizationService.js';

const contactFields = [
  'firstName',
  'lastName',
  'title',
  'company',
  'linkedinUrl',
  'email',
  'phone',
  'location',
  'headline',
  'notes',
  'introductionSource',
] as const;

const createContactSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  title: z.string().max(200).nullish(),
  company: z.string().max(200).nullish(),
  linkedinUrl: z.string().max(500).nullish(),
  email: z.string().email().max(200).nullish(),
  phone: z.string().max(50).nullish(),
  location: z.string().max(200).nullish(),
  headline: z.string().nullish(),
  status: z.enum(['target', 'requested', 'connected', 'engaged', 'relationship']).optional(),
  seniority: z.enum(['ic', 'manager', 'director', 'vp', 'c_suite']).nullish(),
  notes: z.string().nullish(),
  introductionSource: z.string().max(200).nullish(),
  mutualConnectionsCount: z.number().int().min(0).optional(),
  isActiveOnLinkedin: z.boolean().optional(),
  hasOpenToConnect: z.boolean().optional(),
});

const updateContactSchema = createContactSchema.partial();

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

function buildFieldSources(
  body: Record<string, unknown>,
  existing?: Record<string, string> | null
): Record<string, string> {
  const sources: Record<string, string> = existing ? { ...existing } : {};
  for (const field of contactFields) {
    if (body[field] !== undefined) {
      sources[field] = 'manual';
    }
  }
  return sources;
}

const listContactsSchema = z.object({
  q: z.string().optional(),
  status: z.string().optional(), // comma-separated
  category: z.string().optional(), // comma-separated UUIDs
  tag: z.string().optional(), // comma-separated UUIDs
  source: z.string().optional(), // e.g. "apollo", "linkedin", "manual"
  scoreMin: z.coerce.number().int().min(0).max(100).optional(),
  scoreMax: z.coerce.number().int().min(0).max(100).optional(),
  location: z.string().optional(),
  sort: z
    .enum([
      'name',
      '-name',
      'company',
      '-company',
      'relationship_score',
      '-relationship_score',
      'last_interaction',
      '-last_interaction',
      'created_at',
      '-created_at',
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const validStatuses = ['target', 'requested', 'connected', 'engaged', 'relationship'];

function buildOrderBy(sort: string | undefined): Prisma.ContactOrderByWithRelationInput[] {
  switch (sort) {
    case 'name':
      return [{ lastName: 'asc' }, { firstName: 'asc' }];
    case '-name':
      return [{ lastName: 'desc' }, { firstName: 'desc' }];
    case 'company':
      return [{ company: 'asc' }];
    case '-company':
      return [{ company: 'desc' }];
    case 'relationship_score':
      return [{ relationshipScore: 'asc' }];
    case '-relationship_score':
      return [{ relationshipScore: 'desc' }];
    case 'last_interaction':
      return [{ lastInteractionAt: 'asc' }];
    case '-last_interaction':
      return [{ lastInteractionAt: 'desc' }];
    case 'created_at':
      return [{ createdAt: 'asc' }];
    case '-created_at':
      return [{ createdAt: 'desc' }];
    default:
      return [{ createdAt: 'desc' }];
  }
}

export async function contactRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  // GET /api/contacts — List/search contacts
  fastify.get('/contacts', async (request, reply) => {
    const parseResult = listContactsSchema.safeParse(request.query);
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

    const { q, status, category, tag, source, scoreMin, scoreMax, location, sort, limit, offset } =
      parseResult.data;

    // Full-text search: use raw SQL for ts_rank scoring
    if (q && q.trim().length > 0) {
      const searchTerm = q.trim();

      // Build WHERE conditions
      const conditions: string[] = ['c.deleted_at IS NULL'];
      const params: unknown[] = [];
      let paramIndex = 1;

      // Full-text search condition
      conditions.push(`c.search_vector @@ plainto_tsquery('english', $${paramIndex})`);
      params.push(searchTerm);
      paramIndex++;

      // Status filter
      if (status) {
        const statuses = status.split(',').filter((s) => validStatuses.includes(s));
        if (statuses.length > 0) {
          const placeholders = statuses.map(() => `$${paramIndex++}`);
          conditions.push(`c.status::text IN (${placeholders.join(', ')})`);
          params.push(...statuses);
        }
      }

      // Score range
      if (scoreMin !== undefined) {
        conditions.push(`c.relationship_score >= $${paramIndex}`);
        params.push(scoreMin);
        paramIndex++;
      }
      if (scoreMax !== undefined) {
        conditions.push(`c.relationship_score <= $${paramIndex}`);
        params.push(scoreMax);
        paramIndex++;
      }

      // Location
      if (location) {
        conditions.push(`c.location ILIKE $${paramIndex}`);
        params.push(`%${location}%`);
        paramIndex++;
      }

      // Category filter
      if (category) {
        if (category === '__uncategorized__') {
          conditions.push(
            `NOT EXISTS (SELECT 1 FROM contact_categories cc WHERE cc.contact_id = c.id)`
          );
        } else {
          const categoryIds = category.split(',');
          const placeholders = categoryIds.map(() => `$${paramIndex++}`);
          conditions.push(
            `EXISTS (SELECT 1 FROM contact_categories cc WHERE cc.contact_id = c.id AND cc.category_id IN (${placeholders.join(', ')}))`
          );
          params.push(...categoryIds);
        }
      }

      // Tag filter
      if (tag) {
        const tagIds = tag.split(',');
        const placeholders = tagIds.map(() => `$${paramIndex++}`);
        conditions.push(
          `EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id IN (${placeholders.join(', ')}))`
        );
        params.push(...tagIds);
      }

      // Source filter (checks fieldSources->>'firstName')
      if (source) {
        conditions.push(`c.field_sources->>'firstName' = $${paramIndex}`);
        params.push(source);
        paramIndex++;
      }

      const whereClause = conditions.join(' AND ');

      // Count query
      const countResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*) as count FROM contacts c WHERE ${whereClause}`,
        ...params
      );
      const total = Number(countResult[0].count);

      // Build ORDER BY for raw query
      let orderByClause: string;
      switch (sort) {
        case 'name':
          orderByClause = 'c.last_name ASC, c.first_name ASC';
          break;
        case '-name':
          orderByClause = 'c.last_name DESC, c.first_name DESC';
          break;
        case 'company':
          orderByClause = 'c.company ASC NULLS LAST';
          break;
        case '-company':
          orderByClause = 'c.company DESC NULLS LAST';
          break;
        case 'relationship_score':
          orderByClause = 'c.relationship_score ASC';
          break;
        case '-relationship_score':
          orderByClause = 'c.relationship_score DESC';
          break;
        case 'last_interaction':
          orderByClause = 'c.last_interaction_at ASC NULLS LAST';
          break;
        case '-last_interaction':
          orderByClause = 'c.last_interaction_at DESC NULLS LAST';
          break;
        case 'created_at':
          orderByClause = 'c.created_at ASC';
          break;
        case '-created_at':
          orderByClause = 'c.created_at DESC';
          break;
        default:
          orderByClause = `ts_rank(c.search_vector, plainto_tsquery('english', $1)) DESC`;
          break;
      }

      // Data query — select contact IDs with ranking
      const limitParam = paramIndex++;
      const offsetParam = paramIndex++;
      params.push(limit, offset);

      const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT c.id FROM contacts c WHERE ${whereClause} ORDER BY ${orderByClause} LIMIT $${limitParam} OFFSET $${offsetParam}`,
        ...params
      );

      // Fetch full contacts with relations using Prisma
      const ids = rows.map((r) => r.id);
      let contacts: unknown[] = [];
      if (ids.length > 0) {
        const fullContacts = await prisma.contact.findMany({
          where: { id: { in: ids } },
          include: {
            categories: { include: { category: true } },
            tags: { include: { tag: true } },
          },
        });
        // Preserve the order from the raw query
        const contactMap = new Map(fullContacts.map((c) => [c.id, c]));
        contacts = ids.map((id) => contactMap.get(id)).filter(Boolean);
      }

      return {
        success: true,
        data: contacts,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      };
    }

    // Non-search: use Prisma query builder
    const where: Prisma.ContactWhereInput = { deletedAt: null };

    if (status) {
      const statuses = status.split(',').filter((s) => validStatuses.includes(s));
      if (statuses.length > 0) {
        where.status = { in: statuses as Prisma.EnumContactStatusFilter['in'] };
      }
    }

    if (scoreMin !== undefined || scoreMax !== undefined) {
      where.relationshipScore = {};
      if (scoreMin !== undefined) where.relationshipScore.gte = scoreMin;
      if (scoreMax !== undefined) where.relationshipScore.lte = scoreMax;
    }

    if (location) {
      where.location = { contains: location, mode: 'insensitive' };
    }

    if (category) {
      if (category === '__uncategorized__') {
        where.categories = { none: {} };
      } else {
        const categoryIds = category.split(',');
        where.categories = { some: { categoryId: { in: categoryIds } } };
      }
    }

    if (tag) {
      const tagIds = tag.split(',');
      where.tags = { some: { tagId: { in: tagIds } } };
    }

    if (source) {
      where.fieldSources = { path: ['firstName'], equals: source };
    }

    const [total, contacts] = await Promise.all([
      prisma.contact.count({ where }),
      prisma.contact.findMany({
        where,
        include: {
          categories: { include: { category: true } },
          tags: { include: { tag: true } },
        },
        orderBy: buildOrderBy(sort),
        take: limit,
        skip: offset,
      }),
    ]);

    return {
      success: true,
      data: contacts,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    };
  });

  // GET /api/contacts/sources — List distinct import sources
  fastify.get('/contacts/sources', async () => {
    const rows = await prisma.$queryRawUnsafe<{ source: string }[]>(
      `SELECT DISTINCT field_sources->>'firstName' as source FROM contacts WHERE deleted_at IS NULL AND field_sources->>'firstName' IS NOT NULL ORDER BY source`
    );

    return {
      success: true,
      data: rows.map((r) => r.source),
    };
  });

  // POST /api/contacts — Create a contact
  fastify.post('/contacts', async (request, reply) => {
    const parseResult = createContactSchema.safeParse(request.body);
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

    const data = parseResult.data;
    const fieldSources = buildFieldSources(data as Record<string, unknown>);

    try {
      const contact = await prisma.contact.create({
        data: {
          ...data,
          fieldSources,
        },
        include: {
          categories: { include: { category: true } },
          tags: { include: { tag: true } },
        },
      });

      return reply.status(201).send({
        success: true,
        data: contact,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Unique constraint failed')) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'DUPLICATE_CONTACT',
            message: 'A contact with this LinkedIn URL already exists',
          },
        });
      }
      throw err;
    }
  });

  // POST /api/contacts/ai-categorize — AI-powered categorization using Anthropic
  fastify.post('/contacts/ai-categorize', async (request, reply) => {
    if (!config.anthropicApiKey) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'AI_NOT_CONFIGURED',
          message: 'ANTHROPIC_API_KEY is not set. Add it to .env to enable AI categorization.',
        },
      });
    }

    const parseResult = z
      .object({
        contactIds: z.array(z.string().uuid()).optional(),
        force: z.boolean().optional(),
        dryRun: z.boolean().optional(),
      })
      .safeParse(request.body);

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

    const result = await aiCategorizeContacts(parseResult.data);
    return { success: true, data: result };
  });

  // GET /api/contacts/:id — Get a contact
  fastify.get('/contacts/:id', async (request, reply) => {
    const paramResult = uuidParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid contact ID format',
        },
      });
    }

    const contact = await prisma.contact.findFirst({
      where: { id: paramResult.data.id, deletedAt: null },
      include: {
        categories: { include: { category: true } },
        tags: { include: { tag: true } },
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

    return { success: true, data: contact };
  });

  // PUT /api/contacts/:id — Update a contact
  fastify.put('/contacts/:id', async (request, reply) => {
    const paramResult = uuidParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid contact ID format',
        },
      });
    }

    const bodyResult = updateContactSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: bodyResult.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
        },
      });
    }

    const existing = await prisma.contact.findFirst({
      where: { id: paramResult.data.id, deletedAt: null },
    });

    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'CONTACT_NOT_FOUND',
          message: `Contact with ID ${paramResult.data.id} not found`,
        },
      });
    }

    const data = bodyResult.data;
    const fieldSources = buildFieldSources(
      data as Record<string, unknown>,
      existing.fieldSources as Record<string, string> | null
    );

    try {
      const contact = await prisma.contact.update({
        where: { id: paramResult.data.id },
        data: {
          ...data,
          fieldSources,
        },
        include: {
          categories: { include: { category: true } },
          tags: { include: { tag: true } },
        },
      });

      return { success: true, data: contact };
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Unique constraint failed')) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'DUPLICATE_CONTACT',
            message: 'A contact with this LinkedIn URL already exists',
          },
        });
      }
      throw err;
    }
  });

  // DELETE /api/contacts/:id — Soft delete a contact
  fastify.delete('/contacts/:id', async (request, reply) => {
    const paramResult = uuidParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid contact ID format',
        },
      });
    }

    const existing = await prisma.contact.findFirst({
      where: { id: paramResult.data.id, deletedAt: null },
    });

    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'CONTACT_NOT_FOUND',
          message: `Contact with ID ${paramResult.data.id} not found`,
        },
      });
    }

    await prisma.contact.update({
      where: { id: paramResult.data.id },
      data: { deletedAt: new Date() },
    });

    return {
      success: true,
      data: { message: 'Contact soft-deleted', id: paramResult.data.id },
    };
  });

  // POST /api/contacts/bulk-delete — Soft-delete multiple contacts
  fastify.post('/contacts/bulk-delete', async (request, reply) => {
    const bodyResult = z
      .object({
        contactIds: z.array(z.string().uuid()).min(1),
      })
      .safeParse(request.body);

    if (!bodyResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'contactIds must be a non-empty array of UUIDs',
        },
      });
    }

    const { contactIds } = bodyResult.data;

    const result = await prisma.contact.updateMany({
      where: {
        id: { in: contactIds },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    return {
      success: true,
      data: { deleted: result.count },
    };
  });

  // PUT /api/contacts/:id/status — Manual status override
  fastify.put('/contacts/:id/status', async (request, reply) => {
    const paramResult = uuidParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid contact ID format',
        },
      });
    }

    const bodyResult = z
      .object({
        status: z.enum(['target', 'requested', 'connected', 'engaged', 'relationship']),
        reason: z.string().max(500).optional(),
      })
      .safeParse(request.body);

    if (!bodyResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: bodyResult.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
        },
      });
    }

    const result = await manualStatusTransition(
      paramResult.data.id,
      bodyResult.data.status,
      bodyResult.data.reason
    );

    if (!result) {
      const contact = await prisma.contact.findFirst({
        where: { id: paramResult.data.id, deletedAt: null },
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

      // Same status — no transition needed
      return {
        success: true,
        data: {
          message: 'No status change needed',
          currentStatus: contact.status,
        },
      };
    }

    // If transitioning to "connected", log acceptance interaction and recalc score
    let acceptanceResult = null;
    if (result.toStatus === 'connected') {
      acceptanceResult = await handleConnectionAccepted(
        paramResult.data.id,
        result.fromStatus,
        result.toStatus,
        'manual'
      );
    }

    return {
      success: true,
      data: {
        message: 'Status updated',
        fromStatus: result.fromStatus,
        toStatus: result.toStatus,
        trigger: result.trigger,
        reason: result.reason,
        ...(acceptanceResult && { newRelationshipScore: acceptanceResult.newScore }),
      },
    };
  });
}
