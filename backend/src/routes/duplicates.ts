import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { runDuplicateDetection } from '../services/duplicateDetectionService.js';

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

export async function duplicateRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  // GET /api/duplicates — List flagged duplicate pairs
  fastify.get('/duplicates', async (request) => {
    const { status } = request.query as { status?: string };

    const where: Record<string, unknown> = {};
    if (status === 'pending' || status === 'merged' || status === 'dismissed') {
      where.status = status;
    } else {
      where.status = 'pending';
    }

    const pairs = await prisma.duplicatePair.findMany({
      where,
      include: {
        contactA: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            title: true,
            company: true,
            linkedinUrl: true,
            email: true,
            phone: true,
            location: true,
            headline: true,
            status: true,
            relationshipScore: true,
            createdAt: true,
          },
        },
        contactB: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            title: true,
            company: true,
            linkedinUrl: true,
            email: true,
            phone: true,
            location: true,
            headline: true,
            status: true,
            relationshipScore: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { success: true, data: pairs };
  });

  // POST /api/duplicates/scan — Trigger duplicate detection scan
  fastify.post('/duplicates/scan', async () => {
    const result = await runDuplicateDetection();
    return {
      success: true,
      data: result,
    };
  });

  // PUT /api/duplicates/:id/merge — Merge a duplicate pair
  fastify.put('/duplicates/:id/merge', async (request, reply) => {
    const paramResult = uuidParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid pair ID format' },
      });
    }

    const bodySchema = z.object({
      primaryContactId: z.string().uuid(),
    });
    const bodyResult = bodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'primaryContactId is required' },
      });
    }

    const pair = await prisma.duplicatePair.findUnique({
      where: { id: paramResult.data.id },
    });

    if (!pair || pair.status !== 'pending') {
      return reply.status(404).send({
        success: false,
        error: { code: 'PAIR_NOT_FOUND', message: 'Duplicate pair not found or already resolved' },
      });
    }

    const primaryId = bodyResult.data.primaryContactId;
    const secondaryId = primaryId === pair.contactAId ? pair.contactBId : pair.contactAId;

    // Validate primary is one of the pair
    if (primaryId !== pair.contactAId && primaryId !== pair.contactBId) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_PRIMARY',
          message: 'primaryContactId must be one of the contacts in the pair',
        },
      });
    }

    const [primary, secondary] = await Promise.all([
      prisma.contact.findUnique({ where: { id: primaryId } }),
      prisma.contact.findUnique({ where: { id: secondaryId } }),
    ]);

    if (!primary || !secondary) {
      return reply.status(404).send({
        success: false,
        error: { code: 'CONTACT_NOT_FOUND', message: 'One of the contacts not found' },
      });
    }

    // Merge fields from secondary into primary where primary is null
    const updates: Record<string, unknown> = {};
    const mergeableFields = [
      'title',
      'company',
      'linkedinUrl',
      'email',
      'phone',
      'location',
      'headline',
      'seniority',
      'notes',
      'introductionSource',
    ] as const;

    for (const field of mergeableFields) {
      if (!primary[field] && secondary[field]) {
        updates[field] = secondary[field];
      }
    }

    if (secondary.relationshipScore > primary.relationshipScore) {
      updates.relationshipScore = secondary.relationshipScore;
    }

    if (Object.keys(updates).length > 0) {
      await prisma.contact.update({
        where: { id: primaryId },
        data: updates,
      });
    }

    // Soft-delete secondary
    await prisma.contact.update({
      where: { id: secondaryId },
      data: { deletedAt: new Date() },
    });

    // Record merge history
    await prisma.mergeHistory.create({
      data: {
        primaryContactId: primaryId,
        mergedContactId: secondaryId,
        mergedContactData: JSON.parse(JSON.stringify(secondary)),
        mergeType: 'manual',
      },
    });

    // Update pair status
    await prisma.duplicatePair.update({
      where: { id: pair.id },
      data: { status: 'merged', resolvedAt: new Date() },
    });

    return {
      success: true,
      data: { message: 'Contacts merged', primaryContactId: primaryId },
    };
  });

  // PUT /api/duplicates/:id/dismiss — Dismiss a duplicate pair
  fastify.put('/duplicates/:id/dismiss', async (request, reply) => {
    const paramResult = uuidParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid pair ID format' },
      });
    }

    const pair = await prisma.duplicatePair.findUnique({
      where: { id: paramResult.data.id },
    });

    if (!pair || pair.status !== 'pending') {
      return reply.status(404).send({
        success: false,
        error: { code: 'PAIR_NOT_FOUND', message: 'Duplicate pair not found or already resolved' },
      });
    }

    await prisma.duplicatePair.update({
      where: { id: pair.id },
      data: { status: 'dismissed', resolvedAt: new Date() },
    });

    return {
      success: true,
      data: { message: 'Duplicate pair dismissed', id: pair.id },
    };
  });
}
