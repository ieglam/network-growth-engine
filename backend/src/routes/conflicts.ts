import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

export async function conflictRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  // GET /api/conflicts — List data conflicts
  fastify.get('/conflicts', async (request) => {
    const { resolved } = request.query as { resolved?: string };

    const where: Record<string, unknown> = {};
    if (resolved === 'true') {
      where.resolved = true;
    } else if (resolved === 'false' || resolved === undefined) {
      where.resolved = false;
    }

    const conflicts = await prisma.dataConflict.findMany({
      where,
      include: {
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            company: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { success: true, data: conflicts };
  });

  // GET /api/conflicts/count — Count unresolved conflicts
  fastify.get('/conflicts/count', async () => {
    const count = await prisma.dataConflict.count({
      where: { resolved: false },
    });
    return { success: true, data: { count } };
  });

  // PUT /api/conflicts/:id/resolve — Resolve a conflict
  fastify.put('/conflicts/:id/resolve', async (request, reply) => {
    const paramResult = uuidParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid conflict ID format' },
      });
    }

    const bodySchema = z.object({
      resolvedValue: z.string(),
    });
    const bodyResult = bodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'resolvedValue is required' },
      });
    }

    const conflict = await prisma.dataConflict.findUnique({
      where: { id: paramResult.data.id },
    });

    if (!conflict || conflict.resolved) {
      return reply.status(404).send({
        success: false,
        error: { code: 'CONFLICT_NOT_FOUND', message: 'Conflict not found or already resolved' },
      });
    }

    // Update the conflict record
    const updated = await prisma.dataConflict.update({
      where: { id: conflict.id },
      data: {
        resolved: true,
        resolvedValue: bodyResult.data.resolvedValue,
        resolvedAt: new Date(),
      },
    });

    // Apply the resolved value to the contact
    const fieldName = conflict.fieldName;
    await prisma.contact.update({
      where: { id: conflict.contactId },
      data: {
        [fieldName]: bodyResult.data.resolvedValue,
      },
    });

    return {
      success: true,
      data: { message: 'Conflict resolved', id: updated.id },
    };
  });
}
