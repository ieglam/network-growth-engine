import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const TEMPLATE_MAX_LENGTH = 300;

const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  categoryId: z.string().uuid().nullish(),
  subject: z.string().max(200).nullish(),
  body: z.string().min(1).max(TEMPLATE_MAX_LENGTH),
  isActive: z.boolean().optional(),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  categoryId: z.string().uuid().nullish(),
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
    const { categoryId, active } = request.query as {
      categoryId?: string;
      active?: string;
    };

    const where: Record<string, unknown> = {};
    if (categoryId) where.categoryId = categoryId;
    if (active === 'true') where.isActive = true;
    if (active === 'false') where.isActive = false;

    const templates = await prisma.template.findMany({
      where,
      include: { category: { select: { id: true, name: true } } },
      orderBy: [{ name: 'asc' }],
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
      include: { category: { select: { id: true, name: true } } },
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
      include: { category: { select: { id: true, name: true } } },
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

  // POST /api/templates/:id/render — Render template with contact data
  fastify.post('/templates/:id/render', async (request, reply) => {
    const paramResult = uuidParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid template ID format' },
      });
    }

    const bodyResult = z.object({ contactId: z.string().uuid() }).safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'contactId is required' },
      });
    }

    const template = await prisma.template.findUnique({
      where: { id: paramResult.data.id },
    });

    if (!template) {
      return reply.status(404).send({
        success: false,
        error: { code: 'TEMPLATE_NOT_FOUND', message: 'Template not found' },
      });
    }

    const contact = await prisma.contact.findFirst({
      where: { id: bodyResult.data.contactId, deletedAt: null },
    });

    if (!contact) {
      return reply.status(404).send({
        success: false,
        error: { code: 'CONTACT_NOT_FOUND', message: 'Contact not found' },
      });
    }

    const tokenData: Record<string, string> = {
      first_name: contact.firstName,
      last_name: contact.lastName,
      company: contact.company || '',
      title: contact.title || '',
      mutual_connection: '',
      recent_post: '',
      category_context: '',
      custom: '',
    };

    const rendered = renderTemplate(template.body, tokenData);

    return {
      success: true,
      data: {
        rendered,
        characterCount: rendered.length,
        exceeds300: rendered.length > TEMPLATE_MAX_LENGTH,
      },
    };
  });

  // POST /api/templates/:id/preview — Preview template with sample data
  fastify.post('/templates/:id/preview', async (request, reply) => {
    const paramResult = uuidParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid template ID format' },
      });
    }

    const bodyResult = z
      .object({
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        company: z.string().optional(),
        title: z.string().optional(),
        mutual_connection: z.string().optional(),
        recent_post: z.string().optional(),
        category_context: z.string().optional(),
        custom: z.string().optional(),
      })
      .safeParse(request.body);

    if (!bodyResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid preview data' },
      });
    }

    const template = await prisma.template.findUnique({
      where: { id: paramResult.data.id },
    });

    if (!template) {
      return reply.status(404).send({
        success: false,
        error: { code: 'TEMPLATE_NOT_FOUND', message: 'Template not found' },
      });
    }

    const tokenData: Record<string, string> = {
      first_name: '',
      last_name: '',
      company: '',
      title: '',
      mutual_connection: '',
      recent_post: '',
      category_context: '',
      custom: '',
      ...bodyResult.data,
    };

    const rendered = renderTemplate(template.body, tokenData);

    return {
      success: true,
      data: {
        rendered,
        characterCount: rendered.length,
        exceeds300: rendered.length > TEMPLATE_MAX_LENGTH,
      },
    };
  });
}

function renderTemplate(body: string, data: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => {
    return data[token] ?? '';
  });
}
