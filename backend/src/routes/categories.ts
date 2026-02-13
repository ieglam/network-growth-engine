import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  relevanceWeight: z.number().int().min(1).max(10),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  relevanceWeight: z.number().int().min(1).max(10).optional(),
});

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

const assignCategoriesSchema = z.object({
  categoryIds: z.array(z.string().uuid()).min(1),
});

export async function categoryRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  // GET /api/categories — List all categories
  fastify.get('/categories', async () => {
    const categories = await prisma.category.findMany({
      include: { _count: { select: { contacts: true } } },
      orderBy: { relevanceWeight: 'desc' },
    });

    return {
      success: true,
      data: categories.map((c) => ({
        id: c.id,
        name: c.name,
        relevanceWeight: c.relevanceWeight,
        contactCount: c._count.contacts,
        createdAt: c.createdAt,
      })),
    };
  });

  // POST /api/categories — Create a category
  fastify.post('/categories', async (request, reply) => {
    const parseResult = createCategorySchema.safeParse(request.body);
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

    try {
      const category = await prisma.category.create({
        data: parseResult.data,
      });
      return reply.status(201).send({ success: true, data: category });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Unique constraint failed')) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'DUPLICATE_CATEGORY',
            message: 'A category with this name already exists',
          },
        });
      }
      throw err;
    }
  });

  // PUT /api/categories/:id — Update a category
  fastify.put('/categories/:id', async (request, reply) => {
    const paramResult = uuidParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid category ID format' },
      });
    }

    const bodyResult = updateCategorySchema.safeParse(request.body);
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

    const existing = await prisma.category.findUnique({
      where: { id: paramResult.data.id },
    });

    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'CATEGORY_NOT_FOUND',
          message: `Category with ID ${paramResult.data.id} not found`,
        },
      });
    }

    try {
      const category = await prisma.category.update({
        where: { id: paramResult.data.id },
        data: bodyResult.data,
      });
      return { success: true, data: category };
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Unique constraint failed')) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'DUPLICATE_CATEGORY',
            message: 'A category with this name already exists',
          },
        });
      }
      throw err;
    }
  });

  // DELETE /api/categories/:id — Delete a category
  fastify.delete('/categories/:id', async (request, reply) => {
    const paramResult = uuidParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid category ID format' },
      });
    }

    const existing = await prisma.category.findUnique({
      where: { id: paramResult.data.id },
    });

    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'CATEGORY_NOT_FOUND',
          message: `Category with ID ${paramResult.data.id} not found`,
        },
      });
    }

    // Cascade delete handles contact_categories via schema
    await prisma.category.delete({ where: { id: paramResult.data.id } });

    return {
      success: true,
      data: { message: 'Category deleted', id: paramResult.data.id },
    };
  });

  // POST /api/contacts/:id/categories — Assign categories to a contact
  fastify.post('/contacts/:id/categories', async (request, reply) => {
    const paramResult = uuidParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid contact ID format' },
      });
    }

    const bodyResult = assignCategoriesSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'categoryIds must be a non-empty array of UUIDs',
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

    const { categoryIds } = bodyResult.data;

    // Verify all categories exist
    const categories = await prisma.category.findMany({
      where: { id: { in: categoryIds } },
    });

    if (categories.length !== categoryIds.length) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_CATEGORY',
          message: 'One or more category IDs are invalid',
        },
      });
    }

    // Upsert: skipDuplicates avoids error on re-assignment
    await prisma.contactCategory.createMany({
      data: categoryIds.map((categoryId) => ({
        contactId: paramResult.data.id,
        categoryId,
      })),
      skipDuplicates: true,
    });

    const updated = await prisma.contact.findUnique({
      where: { id: paramResult.data.id },
      include: {
        categories: { include: { category: true } },
        tags: { include: { tag: true } },
      },
    });

    return { success: true, data: updated };
  });
}
