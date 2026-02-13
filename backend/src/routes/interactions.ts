import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

const INTERACTION_POINTS: Record<string, number> = {
  linkedin_message: 5,
  linkedin_dm_sent: 2,
  linkedin_dm_received: 3,
  email: 4,
  meeting_1on1_inperson: 10,
  meeting_1on1_virtual: 8,
  meeting_group: 4,
  linkedin_comment_given: 2,
  linkedin_comment_received: 3,
  linkedin_like_given: 1,
  linkedin_like_received: 2,
  introduction_given: 7,
  introduction_received: 8,
  manual_note: 1,
  connection_request_sent: 3,
  connection_request_accepted: 5,
};

const interactionTypes = [
  'linkedin_message',
  'linkedin_dm_sent',
  'linkedin_dm_received',
  'email',
  'meeting_1on1_inperson',
  'meeting_1on1_virtual',
  'meeting_group',
  'linkedin_comment_given',
  'linkedin_comment_received',
  'linkedin_like_given',
  'linkedin_like_received',
  'introduction_given',
  'introduction_received',
  'manual_note',
  'connection_request_sent',
  'connection_request_accepted',
] as const;

const interactionSources = ['manual', 'linkedin', 'gmail', 'calendar'] as const;

const createInteractionSchema = z.object({
  type: z.enum(interactionTypes),
  source: z.enum(interactionSources).optional(),
  occurredAt: z.coerce.date().optional(),
  metadata: z
    .object({
      notes: z.string().optional(),
      location: z.string().optional(),
      threadId: z.string().optional(),
      meetingLink: z.string().optional(),
      subject: z.string().optional(),
    })
    .passthrough()
    .optional(),
});

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

const listInteractionsSchema = z.object({
  type: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export async function interactionRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  // POST /api/contacts/:id/interactions — Log an interaction
  fastify.post('/contacts/:id/interactions', async (request, reply) => {
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

    const bodyResult = createInteractionSchema.safeParse(request.body);
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

    const data = bodyResult.data;
    const occurredAt = data.occurredAt || new Date();
    const pointsValue = INTERACTION_POINTS[data.type] || 0;

    const [interaction] = await prisma.$transaction([
      prisma.interaction.create({
        data: {
          contactId: paramResult.data.id,
          type: data.type,
          source: data.source || 'manual',
          occurredAt,
          metadata: (data.metadata as Prisma.InputJsonValue) || undefined,
          pointsValue,
        },
      }),
      prisma.contact.update({
        where: { id: paramResult.data.id },
        data: {
          lastInteractionAt: occurredAt,
        },
      }),
    ]);

    return reply.status(201).send({
      success: true,
      data: interaction,
    });
  });

  // GET /api/contacts/:id/interactions — List interactions for a contact
  fastify.get('/contacts/:id/interactions', async (request, reply) => {
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

    const queryResult = listInteractionsSchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: queryResult.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
        },
      });
    }

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

    const { type, limit, offset } = queryResult.data;

    const where: Record<string, unknown> = { contactId: paramResult.data.id };
    if (type) {
      const types = type
        .split(',')
        .filter((t) => interactionTypes.includes(t as (typeof interactionTypes)[number]));
      if (types.length > 0) {
        where.type = { in: types };
      }
    }

    const [total, interactions] = await Promise.all([
      prisma.interaction.count({ where }),
      prisma.interaction.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        take: limit,
        skip: offset,
      }),
    ]);

    return {
      success: true,
      data: interactions,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    };
  });
}
