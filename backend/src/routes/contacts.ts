import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

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

export async function contactRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
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
}
