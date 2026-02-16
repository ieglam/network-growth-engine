import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { calculateContactScore, loadScoringConfig } from '../services/scoringService.js';
import { manualStatusTransition } from '../services/statusTransitionService.js';

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

export async function queueRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  // GET /api/queue/today — Get today's queue items
  fastify.get('/queue/today', async () => {
    const today = new Date();
    const queueDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const items = await prisma.queueItem.findMany({
      where: { queueDate },
      include: {
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            title: true,
            company: true,
            linkedinUrl: true,
            status: true,
            relationshipScore: true,
          },
        },
        template: {
          select: { id: true, name: true, persona: true },
        },
      },
      orderBy: [{ actionType: 'asc' }, { createdAt: 'asc' }],
    });

    return { success: true, data: items };
  });

  // GET /api/queue/summary — Get queue summary counts
  fastify.get('/queue/summary', async () => {
    const today = new Date();
    const queueDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const [pending, approved, executed, skipped, snoozed] = await Promise.all([
      prisma.queueItem.count({ where: { queueDate, status: 'pending' } }),
      prisma.queueItem.count({ where: { queueDate, status: 'approved' } }),
      prisma.queueItem.count({ where: { queueDate, status: 'executed' } }),
      prisma.queueItem.count({ where: { queueDate, status: 'skipped' } }),
      prisma.queueItem.count({ where: { queueDate, status: 'snoozed' } }),
    ]);

    return {
      success: true,
      data: {
        date: queueDate.toISOString().slice(0, 10),
        pending,
        approved,
        executed,
        skipped,
        snoozed,
        total: pending + approved + executed + skipped + snoozed,
      },
    };
  });

  // PUT /api/queue/:id/done — Mark item as executed
  fastify.put('/queue/:id/done', async (request, reply) => {
    const paramResult = uuidParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid queue item ID format' },
      });
    }

    const bodyResult = z
      .object({
        notes: z.string().max(1000).optional(),
      })
      .safeParse(request.body);

    const item = await prisma.queueItem.findUnique({
      where: { id: paramResult.data.id },
    });

    if (!item) {
      return reply.status(404).send({
        success: false,
        error: { code: 'QUEUE_ITEM_NOT_FOUND', message: 'Queue item not found' },
      });
    }

    const now = new Date();
    const notes = bodyResult.success ? bodyResult.data.notes : undefined;

    // Update queue item
    const updated = await prisma.queueItem.update({
      where: { id: item.id },
      data: {
        status: 'executed',
        executedAt: now,
        result: 'success',
        notes: notes || item.notes,
      },
    });

    // Log interaction based on action type
    const interactionType =
      item.actionType === 'connection_request'
        ? 'connection_request_sent'
        : item.actionType === 'follow_up'
          ? 'linkedin_message'
          : 'linkedin_message';

    await prisma.interaction.create({
      data: {
        contactId: item.contactId,
        type: interactionType,
        source: 'manual',
        occurredAt: now,
        pointsValue: interactionType === 'connection_request_sent' ? 3 : 4,
        metadata: { queueItemId: item.id, notes: notes || null },
      },
    });

    // Update contact's last interaction timestamp
    await prisma.contact.update({
      where: { id: item.contactId },
      data: { lastInteractionAt: now },
    });

    // Auto-transition: connection_request done → status "requested"
    let statusTransition = null;
    if (item.actionType === 'connection_request') {
      statusTransition = await manualStatusTransition(
        item.contactId,
        'requested',
        'Connection request sent via queue'
      );
    }

    // Recalculate relationship score immediately
    const config = await loadScoringConfig();
    const newScore = await calculateContactScore(item.contactId, config, now);
    await prisma.contact.update({
      where: { id: item.contactId },
      data: { relationshipScore: newScore },
    });

    return {
      success: true,
      data: {
        ...updated,
        statusTransition,
        newRelationshipScore: newScore,
      },
    };
  });

  // PUT /api/queue/:id/skip — Mark item as skipped
  fastify.put('/queue/:id/skip', async (request, reply) => {
    const paramResult = uuidParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid queue item ID format' },
      });
    }

    const bodyResult = z
      .object({
        reason: z.string().max(500).optional(),
      })
      .safeParse(request.body);

    const item = await prisma.queueItem.findUnique({
      where: { id: paramResult.data.id },
    });

    if (!item) {
      return reply.status(404).send({
        success: false,
        error: { code: 'QUEUE_ITEM_NOT_FOUND', message: 'Queue item not found' },
      });
    }

    const reason = bodyResult.success ? bodyResult.data.reason : undefined;

    const updated = await prisma.queueItem.update({
      where: { id: item.id },
      data: {
        status: 'skipped',
        notes: reason || item.notes,
      },
    });

    return { success: true, data: updated };
  });

  // PUT /api/queue/:id/snooze — Snooze item to a future date
  fastify.put('/queue/:id/snooze', async (request, reply) => {
    const paramResult = uuidParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid queue item ID format' },
      });
    }

    const bodyResult = z
      .object({
        snoozeUntil: z.coerce.date(),
      })
      .safeParse(request.body);

    if (!bodyResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'snoozeUntil date is required' },
      });
    }

    const item = await prisma.queueItem.findUnique({
      where: { id: paramResult.data.id },
    });

    if (!item) {
      return reply.status(404).send({
        success: false,
        error: { code: 'QUEUE_ITEM_NOT_FOUND', message: 'Queue item not found' },
      });
    }

    const updated = await prisma.queueItem.update({
      where: { id: item.id },
      data: {
        status: 'snoozed',
        snoozeUntil: bodyResult.data.snoozeUntil,
      },
    });

    return { success: true, data: updated };
  });

  // POST /api/queue/approve — Batch approve items
  fastify.post('/queue/approve', async (request, reply) => {
    const bodyResult = z
      .object({
        ids: z.array(z.string().uuid()).min(1),
      })
      .safeParse(request.body);

    if (!bodyResult.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'ids array is required' },
      });
    }

    const result = await prisma.queueItem.updateMany({
      where: {
        id: { in: bodyResult.data.ids },
        status: 'pending',
      },
      data: { status: 'approved' },
    });

    return {
      success: true,
      data: { approved: result.count },
    };
  });
}
