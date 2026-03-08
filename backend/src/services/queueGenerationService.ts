import { prisma } from '../lib/prisma.js';

const TEMPLATE_MAX_LENGTH = 300;
const DEFAULT_SKIP_REQUEUE_DAYS = 30;

export interface QueueGenerationResult {
  connectionRequests: number;
  reEngagements: number;
  carriedOver: number;
  total: number;
  flaggedForEditing: number;
}

function renderTemplate(body: string, data: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => {
    return data[token] ?? '';
  });
}

/**
 * Get the number of days a skipped contact should be excluded from the queue.
 * Reads from the Settings table; falls back to DEFAULT_SKIP_REQUEUE_DAYS.
 */
async function getSkipRequeueDays(): Promise<number> {
  const setting = await prisma.settings.findUnique({
    where: { key: 'skip_requeue_days' },
  });
  if (!setting) return DEFAULT_SKIP_REQUEUE_DAYS;
  const parsed = parseInt(setting.value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SKIP_REQUEUE_DAYS;
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
 *
 * 1. Clear today's stale pending/approved items
 * 2. Carry over previous days' pending items (NOT skipped/snoozed)
 * 3. Check weekly rate limit
 * 4. Exclude contacts skipped within the configurable window (default 30 days)
 * 5. Select top targets by priority score
 * 6. Add re-engagements
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
    carriedOver: 0,
    total: 0,
    flaggedForEditing: 0,
  };

  const alreadyQueued = new Set<string>();

  // 1. Clear existing pending/approved items for today (will be regenerated)
  await prisma.queueItem.deleteMany({
    where: {
      queueDate,
      status: { in: ['pending', 'approved'] },
    },
  });

  // 2. Carry over previous days' pending items to today's queue.
  //    Only pending items are carried over — skipped and snoozed items stay as-is.
  const overdueItems = await prisma.queueItem.findMany({
    where: {
      queueDate: { lt: queueDate },
      status: 'pending',
    },
  });

  for (const item of overdueItems) {
    await prisma.queueItem.update({
      where: { id: item.id },
      data: { queueDate },
    });
    alreadyQueued.add(item.contactId);
    result.carriedOver++;
  }

  // 3. Check weekly rate limit
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
    result.total = result.carriedOver;
    return result;
  }

  // 4. Get contacts skipped within the configurable window — exclude from new targets
  const skipDays = await getSkipRequeueDays();
  const skipCutoff = new Date(queueDate);
  skipCutoff.setDate(skipCutoff.getDate() - skipDays);

  const recentlySkippedItems = await prisma.queueItem.findMany({
    where: {
      status: 'skipped',
      queueDate: { gte: skipCutoff },
    },
    select: { contactId: true },
    distinct: ['contactId'],
  });

  const skippedContactIds = new Set(recentlySkippedItems.map((i) => i.contactId));

  // 5. Select top targets by priority_score, excluding carried-over and recently-skipped
  const requestSlots = Math.min(maxNewRequests, remainingCapacity);
  const excludeIds = [...alreadyQueued, ...skippedContactIds];

  if (requestSlots > 0) {
    const targets = await prisma.contact.findMany({
      where: {
        status: 'target',
        deletedAt: null,
        ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
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

  // 6. Add re-engagements: score dropped >15 in 30 days
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

  result.total = result.connectionRequests + result.reEngagements + result.carriedOver;

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
