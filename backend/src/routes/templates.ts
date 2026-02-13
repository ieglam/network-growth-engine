import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const TEMPLATE_MAX_LENGTH = 300;

const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  persona: z.string().min(1).max(100),
  subject: z.string().max(200).nullish(),
  body: z.string().min(1).max(TEMPLATE_MAX_LENGTH),
  isActive: z.boolean().optional(),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  persona: z.string().min(1).max(100).optional(),
  subject: z.string().max(200).nullish(),
  body: z.string().min(1).max(TEMPLATE_MAX_LENGTH).optional(),
  isActive: z.boolean().optional(),
});

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

export async function templateRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  // GET /api/templates — List all templates
  fastify.get('/templates', async (request) => {
    const { persona, active } = request.query as {
      persona?: string;
      active?: string;
    };

    const where: Record<string, unknown> = {};
    if (persona) where.persona = persona;
    if (active === 'true') where.isActive = true;
    if (active === 'false') where.isActive = false;

    const templates = await prisma.template.findMany({
      where,
      orderBy: [{ persona: 'asc' }, { name: 'asc' }],
    });

    return { success: true, data: templates };
  });

  // POST /api/templates — Create a template
  fastify.post('/templates', async (request, reply) => {
    const parseResult = createTemplateSchema.safeParse(request.body);
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

    const template = await prisma.template.create({
      data: parseResult.data,
    });

    return reply.status(201).send({ success: true, data: template });
  });

  // PUT /api/templates/:id — Update a template
  fastify.put('/templates/:id', async (request, reply) => {
    const paramResult = uuidParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid template ID format',
        },
      });
    }

    const bodyResult = updateTemplateSchema.safeParse(request.body);
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

    const existing = await prisma.template.findUnique({
      where: { id: paramResult.data.id },
    });

    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'TEMPLATE_NOT_FOUND',
          message: `Template with ID ${paramResult.data.id} not found`,
        },
      });
    }

    const template = await prisma.template.update({
      where: { id: paramResult.data.id },
      data: bodyResult.data,
    });

    return { success: true, data: template };
  });

  // DELETE /api/templates/:id — Delete a template
  fastify.delete('/templates/:id', async (request, reply) => {
    const paramResult = uuidParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid template ID format',
        },
      });
    }

    const existing = await prisma.template.findUnique({
      where: { id: paramResult.data.id },
    });

    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'TEMPLATE_NOT_FOUND',
          message: `Template with ID ${paramResult.data.id} not found`,
        },
      });
    }

    await prisma.template.delete({ where: { id: paramResult.data.id } });

    return {
      success: true,
      data: { message: 'Template deleted', id: paramResult.data.id },
    };
  });
}
