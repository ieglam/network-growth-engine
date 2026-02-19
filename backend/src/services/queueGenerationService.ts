import { prisma } from '../lib/prisma.js';

const TEMPLATE_MAX_LENGTH = 300;

export interface QueueGenerationResult {
  connectionRequests: number;
  reEngagements: number;
  total: number;
  flaggedForEditing: number;
}

function renderTemplate(body: string, data: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => {
    return data[token] ?? '';
  });
}

/**
 * Find the best matching template for a contact based on their categories.
 * Uses exact categoryId FK match. Falls back to least-used active template.
 */
async function findTemplateForContact(
  contactId: string
): Promise<{ id: string; body: string } | null> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, deletedAt: null },
    include: { categories: { select: { categoryId: true } } },
  });

  if (!contact) return null;

  const categoryIds = contact.categories.map((cc) => cc.categoryId);

  if (categoryIds.length > 0) {
    const matched = await prisma.template.findFirst({
      where: { isActive: true, categoryId: { in: categoryIds } },
      orderBy: { timesUsed: 'asc' },
    });

    if (matched) return { id: matched.id, body: matched.body };
  }

  // Fallback: least-used active template
  const fallback = await prisma.template.findFirst({
    where: { isActive: true },
    orderBy: { timesUsed: 'asc' },
  });

  return fallback ? { id: fallback.id, body: fallback.body } : null;
}

/**
 * Generate the daily queue.
 * Clears all pending/approved items for today first, then generates fresh.
 */
export async function generateDailyQueue(options?: {
  maxNewRequests?: number;
  weeklyLimit?: number;
  queueDate?: Date;
}): Promise<QueueGenerationResult> {
  const maxNewRequests = options?.maxNewRequests ?? 20;
  const weeklyLimit = options?.weeklyLimit ?? 100;
  const today = options?.queueDate ?? new Date();
  const queueDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const result: QueueGenerationResult = {
    connectionRequests: 0,
    reEngagements: 0,
    total: 0,
    flaggedForEditing: 0,
  };

  // 1. Clear existing pending/approved items for today
  await prisma.queueItem.deleteMany({
    where: {
      queueDate,
      status: { in: ['pending', 'approved'] },
    },
  });

  // 2. Check weekly rate limit
  const weekStart = getWeekStart(queueDate);
  const sentThisWeek = await prisma.queueItem.count({
    where: {
      actionType: 'connection_request',
      status: 'executed',
      executedAt: { gte: weekStart },
    },
  });

  const remainingCapacity = weeklyLimit - sentThisWeek;
  if (remainingCapacity <= 0) {
    return result;
  }

  // 3. Select top targets by priority_score
  const alreadyQueued = new Set<string>();
  const requestSlots = Math.min(maxNewRequests, remainingCapacity);

  if (requestSlots > 0) {
    const targets = await prisma.contact.findMany({
      where: {
        status: 'target',
        deletedAt: null,
      },
      orderBy: { priorityScore: 'desc' },
      take: requestSlots,
    });

    for (const target of targets) {
      const template = await findTemplateForContact(target.id);
      let personalizedMessage: string | null = null;
      let flagged = false;

      if (template) {
        const tokenData: Record<string, string> = {
          first_name: target.firstName,
          last_name: target.lastName,
          company: target.company || '',
          title: target.title || '',
          mutual_connection: '',
          recent_post: '',
          category_context: '',
          custom: '',
        };

        personalizedMessage = renderTemplate(template.body, tokenData);

        if (personalizedMessage.length > TEMPLATE_MAX_LENGTH) {
          flagged = true;
          result.flaggedForEditing++;
        }
      }

      await prisma.queueItem.create({
        data: {
          contactId: target.id,
          queueDate,
          actionType: 'connection_request',
          templateId: template?.id || null,
          personalizedMessage,
          notes: flagged ? 'EXCEEDS_300_CHARS: Requires manual editing' : null,
        },
      });

      alreadyQueued.add(target.id);
      result.connectionRequests++;
    }
  }

  // 4. Add re-engagements: score dropped >15 in 30 days
  const thirtyDaysAgo = new Date(queueDate);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const engagedContacts = await prisma.contact.findMany({
    where: {
      status: { in: ['engaged', 'relationship'] },
      deletedAt: null,
      id: { notIn: Array.from(alreadyQueued) },
    },
    select: { id: true, relationshipScore: true },
  });

  for (const contact of engagedContacts) {
    const oldScore = await prisma.scoreHistory.findFirst({
      where: {
        contactId: contact.id,
        scoreType: 'relationship',
        recordedAt: { gte: thirtyDaysAgo },
      },
      orderBy: { recordedAt: 'asc' },
    });

    if (oldScore && Number(oldScore.scoreValue) - contact.relationshipScore > 15) {
      await prisma.queueItem.create({
        data: {
          contactId: contact.id,
          queueDate,
          actionType: 're_engagement',
          notes: `Score dropped from ${Number(oldScore.scoreValue)} to ${contact.relationshipScore}`,
        },
      });

      alreadyQueued.add(contact.id);
      result.reEngagements++;
    }
  }

  result.total = result.connectionRequests + result.reEngagements;

  return result;
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
