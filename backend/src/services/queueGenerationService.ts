import { prisma } from '../lib/prisma.js';

const TEMPLATE_MAX_LENGTH = 300;

export interface QueueGenerationResult {
  connectionRequests: number;
  followUps: number;
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
 * Find the best matching template for a contact based on their categories.
 * Falls back to any active template if no persona match.
 */
async function findTemplateForContact(
  contactId: string
): Promise<{ id: string; body: string } | null> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, deletedAt: null },
    include: { categories: { include: { category: true } } },
  });

  if (!contact) return null;

  // Try to match template persona to category name (lowercased, partial match)
  const categoryNames = contact.categories.map((cc) => cc.category.name.toLowerCase());

  if (categoryNames.length > 0) {
    const templates = await prisma.template.findMany({
      where: { isActive: true },
      orderBy: { timesUsed: 'asc' },
    });

    for (const tmpl of templates) {
      const persona = tmpl.persona.toLowerCase();
      if (categoryNames.some((cat) => cat.includes(persona) || persona.includes(cat))) {
        return { id: tmpl.id, body: tmpl.body };
      }
    }
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
    followUps: 0,
    reEngagements: 0,
    carriedOver: 0,
    total: 0,
    flaggedForEditing: 0,
  };

  // 1. Check weekly rate limit
  const weekStart = getWeekStart(queueDate);
  const sentThisWeek = await prisma.queueItem.count({
    where: {
      actionType: 'connection_request',
      status: 'executed',
      executedAt: { gte: weekStart },
    },
  });

  const pendingThisWeek = await prisma.queueItem.count({
    where: {
      actionType: 'connection_request',
      status: { in: ['pending', 'approved'] },
      queueDate: { gte: weekStart },
    },
  });

  const remainingCapacity = weeklyLimit - sentThisWeek - pendingThisWeek;
  if (remainingCapacity <= 0) {
    return result;
  }

  // 2. Carry over yesterday's incomplete items
  const yesterday = new Date(queueDate);
  yesterday.setDate(yesterday.getDate() - 1);

  const incompleteItems = await prisma.queueItem.findMany({
    where: {
      queueDate: { lt: queueDate },
      status: 'pending',
    },
  });

  for (const item of incompleteItems) {
    await prisma.queueItem.update({
      where: { id: item.id },
      data: { queueDate },
    });
    result.carriedOver++;
  }

  // 3. Select top targets by priority_score
  const existingToday = await prisma.queueItem.findMany({
    where: { queueDate },
    select: { contactId: true },
  });
  const alreadyQueued = new Set(existingToday.map((q) => q.contactId));

  const requestSlots = Math.min(maxNewRequests, remainingCapacity) - result.carriedOver;

  if (requestSlots > 0) {
    const targets = await prisma.contact.findMany({
      where: {
        status: 'target',
        deletedAt: null,
        id: { notIn: Array.from(alreadyQueued) },
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

  // 4. Add follow-ups: connections from last 7 days without first message
  const sevenDaysAgo = new Date(queueDate);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const recentConnections = await prisma.contact.findMany({
    where: {
      status: 'connected',
      deletedAt: null,
      id: { notIn: Array.from(alreadyQueued) },
      statusHistory: {
        some: {
          toStatus: 'connected',
          createdAt: { gte: sevenDaysAgo },
        },
      },
    },
    take: 10,
  });

  // Filter out those who already have a follow-up interaction
  for (const conn of recentConnections) {
    const hasFollowUp = await prisma.interaction.findFirst({
      where: {
        contactId: conn.id,
        type: 'linkedin_message',
        occurredAt: { gte: sevenDaysAgo },
      },
    });

    if (!hasFollowUp) {
      await prisma.queueItem.create({
        data: {
          contactId: conn.id,
          queueDate,
          actionType: 'follow_up',
          notes: 'New connection — send first message',
        },
      });

      alreadyQueued.add(conn.id);
      result.followUps++;
    }
  }

  // 5. Add re-engagements: score dropped >15 in 30 days
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

  result.total =
    result.connectionRequests + result.followUps + result.reEngagements + result.carriedOver;

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
