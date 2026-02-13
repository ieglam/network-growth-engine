import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

const tagIdParamSchema = z.object({
  id: z.string().uuid(),
  tagId: z.string().uuid(),
});

const addTagsSchema = z.object({
  tags: z.array(z.string().min(1).max(100)).min(1),
});

const bulkTagSchema = z.object({
  contactIds: z.array(z.string().uuid()).min(1),
  tagId: z.string().uuid(),
});

export async function tagRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  // GET /api/tags — List all tags with usage counts
  fastify.get('/tags', async () => {
    const tags = await prisma.tag.findMany({
      include: { _count: { select: { contacts: true } } },
      orderBy: { name: 'asc' },
    });

    return {
      success: true,
      data: tags.map((t) => ({
        id: t.id,
        name: t.name,
        contactCount: t._count.contacts,
        createdAt: t.createdAt,
      })),
    };
  });

  // GET /api/tags/autocomplete?q= — Search tags by prefix
  fastify.get('/tags/autocomplete', async (request) => {
    const { q } = request.query as { q?: string };

    if (!q || q.trim().length === 0) {
      return { success: true, data: [] };
    }

    const tags = await prisma.tag.findMany({
      where: { name: { startsWith: q.trim(), mode: 'insensitive' } },
      take: 10,
      orderBy: { name: 'asc' },
    });

    return {
      success: true,
      data: tags.map((t) => ({ id: t.id, name: t.name })),
    };
  });

  // POST /api/contacts/:id/tags — Add tags to a contact (creates tags if needed)
  fastify.post('/contacts/:id/tags', async (request, reply) => {
    const paramResult = uuidParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid contact ID format' },
      });
    }

    const bodyResult = addTagsSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'tags must be a non-empty array of tag names',
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

    // Upsert tags by name
    const tagIds: string[] = [];
    for (const tagName of bodyResult.data.tags) {
      const tag = await prisma.tag.upsert({
        where: { name: tagName },
        update: {},
        create: { name: tagName },
      });
      tagIds.push(tag.id);
    }

    // Assign tags to contact
    await prisma.contactTag.createMany({
      data: tagIds.map((tagId) => ({
        contactId: paramResult.data.id,
        tagId,
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

  // DELETE /api/contacts/:id/tags/:tagId — Remove a tag from a contact
  fastify.delete('/contacts/:id/tags/:tagId', async (request, reply) => {
    const paramResult = tagIdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid ID format' },
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

    const link = await prisma.contactTag.findUnique({
      where: {
        contactId_tagId: {
          contactId: paramResult.data.id,
          tagId: paramResult.data.tagId,
        },
      },
    });

    if (!link) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'TAG_NOT_ASSIGNED',
          message: 'This tag is not assigned to this contact',
        },
      });
    }

    await prisma.contactTag.delete({
      where: {
        contactId_tagId: {
          contactId: paramResult.data.id,
          tagId: paramResult.data.tagId,
        },
      },
    });

    return {
      success: true,
      data: { message: 'Tag removed from contact' },
    };
  });

  // POST /api/contacts/bulk/tags — Add tag to multiple contacts
  fastify.post('/contacts/bulk/tags', async (request, reply) => {
    const bodyResult = bulkTagSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'contactIds and tagId are required',
        },
      });
    }

    const { contactIds, tagId } = bodyResult.data;

    // Verify tag exists
    const tag = await prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag) {
      return reply.status(404).send({
        success: false,
        error: { code: 'TAG_NOT_FOUND', message: 'Tag not found' },
      });
    }

    // Verify contacts exist
    const contacts = await prisma.contact.findMany({
      where: { id: { in: contactIds }, deletedAt: null },
      select: { id: true },
    });

    const result = await prisma.contactTag.createMany({
      data: contacts.map((c) => ({ contactId: c.id, tagId })),
      skipDuplicates: true,
    });

    return {
      success: true,
      data: {
        assigned: result.count,
        totalRequested: contactIds.length,
      },
    };
  });

  // DELETE /api/contacts/bulk/tags — Remove tag from multiple contacts
  fastify.delete('/contacts/bulk/tags', async (request, reply) => {
    const bodyResult = bulkTagSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'contactIds and tagId are required',
        },
      });
    }

    const { contactIds, tagId } = bodyResult.data;

    const result = await prisma.contactTag.deleteMany({
      where: {
        contactId: { in: contactIds },
        tagId,
      },
    });

    return {
      success: true,
      data: {
        removed: result.count,
        totalRequested: contactIds.length,
      },
    };
  });
}
