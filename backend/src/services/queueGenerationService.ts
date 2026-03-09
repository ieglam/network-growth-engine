import { prisma } from '../lib/prisma.js';

const TEMPLATE_MAX_LENGTH = 300;
const DEFAULT_SKIP_REQUEUE_DAYS = 30;
const DEFAULT_MAX_PER_COMPANY = 3;

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
 * Get the maximum number of contacts from the same company in a single day's queue.
 * Reads from the Settings table; falls back to DEFAULT_MAX_PER_COMPANY.
 */
async function getMaxPerCompany(): Promise<number> {
  const setting = await prisma.settings.findUnique({
    where: { key: 'max_per_company' },
  });
  if (!setting) return DEFAULT_MAX_PER_COMPANY;
  const parsed = parseInt(setting.value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PER_COMPANY;
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
    include: { categories: { include: { category: { select: { id: true, relevanceWeight: true } } } } },
  });

  if (!contact) return null;

  const categoryIds = contact.categories.map((cc) => cc.categoryId);

  if (categoryIds.length > 0) {
    // Build a map of categoryId → relevanceWeight so we can pick the most
    // specific (highest-weight) category's template instead of an arbitrary one.
    const weightById = new Map<string, number>();
    for (const cc of contact.categories) {
      weightById.set(cc.categoryId, cc.category.relevanceWeight);
    }

    const candidates = await prisma.template.findMany({
      where: { isActive: true, categoryId: { in: categoryIds } },
    });

    if (candidates.length > 0) {
      // Sort by category relevanceWeight DESC, then timesUsed ASC as tiebreaker
      candidates.sort((a, b) => {
        const wA = weightById.get(a.categoryId!) ?? 0;
        const wB = weightById.get(b.categoryId!) ?? 0;
        if (wB !== wA) return wB - wA;
        return a.timesUsed - b.timesUsed;
      });

      const best = candidates[0];
      return { id: best.id, body: best.body };
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

  // 5. Select targets with diversity constraints (company cap + category spread)
  const requestSlots = Math.min(maxNewRequests, remainingCapacity);
  const excludeIds = [...alreadyQueued, ...skippedContactIds];
  const maxPerCompany = await getMaxPerCompany();

  if (requestSlots > 0) {
    // Fetch a larger candidate pool sorted by priority — we need extras to
    // backfill slots when company/category caps exclude high-priority contacts.
    const candidatePool = await prisma.contact.findMany({
      where: {
        status: 'target',
        deletedAt: null,
        ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
      },
      include: {
        categories: { select: { categoryId: true } },
      },
      orderBy: { priorityScore: 'desc' },
      take: requestSlots * 5,
    });

    // Build category weight map for proportional allocation
    const activeCategoryIds = new Set<string>();
    for (const c of candidatePool) {
      for (const cc of c.categories) {
        activeCategoryIds.add(cc.categoryId);
      }
    }

    const categoryWeights = new Map<string, number>();
    if (activeCategoryIds.size > 0) {
      const cats = await prisma.category.findMany({
        where: { id: { in: Array.from(activeCategoryIds) } },
        select: { id: true, relevanceWeight: true },
      });
      for (const cat of cats) {
        categoryWeights.set(cat.id, cat.relevanceWeight);
      }
    }

    // Assign each contact a "primary category" — their highest-weight category
    function primaryCategory(contact: (typeof candidatePool)[0]): string | null {
      let bestId: string | null = null;
      let bestWeight = -1;
      for (const cc of contact.categories) {
        const w = categoryWeights.get(cc.categoryId) ?? 0;
        if (w > bestWeight) {
          bestWeight = w;
          bestId = cc.categoryId;
        }
      }
      return bestId;
    }

    // Calculate proportional slots per category based on relevance weights.
    // Categories with higher weights get proportionally more slots.
    const categoryCandidateCounts = new Map<string | null, number>();
    for (const c of candidatePool) {
      const cat = primaryCategory(c);
      categoryCandidateCounts.set(cat, (categoryCandidateCounts.get(cat) ?? 0) + 1);
    }

    const categorySlots = new Map<string | null, number>();
    const representedCategories = Array.from(categoryCandidateCounts.keys());

    if (representedCategories.length > 0) {
      let totalWeight = 0;
      for (const catId of representedCategories) {
        totalWeight += catId ? (categoryWeights.get(catId) ?? 1) : 1;
      }

      let allocated = 0;
      for (const catId of representedCategories) {
        const w = catId ? (categoryWeights.get(catId) ?? 1) : 1;
        // Each category gets at least 1 slot if it has candidates
        const slots = Math.max(1, Math.round((w / totalWeight) * requestSlots));
        categorySlots.set(catId, slots);
        allocated += slots;
      }

      // If rounding gave us too many/few, adjust the largest category
      if (allocated !== requestSlots) {
        let largestCat: string | null = null;
        let largestSlots = 0;
        for (const [catId, slots] of categorySlots) {
          if (slots > largestSlots) {
            largestSlots = slots;
            largestCat = catId;
          }
        }
        if (largestCat !== null || categorySlots.has(null)) {
          const adjustCat = largestCat;
          categorySlots.set(adjustCat, (categorySlots.get(adjustCat) ?? 0) + (requestSlots - allocated));
        }
      }
    }

    // Select contacts with diversity constraints
    const selected: (typeof candidatePool)[0][] = [];
    const companyCounts = new Map<string, number>();
    const categoryFilled = new Map<string | null, number>();
    const deferred: (typeof candidatePool)[0][] = [];

    for (const candidate of candidatePool) {
      if (selected.length >= requestSlots) break;

      // Enforce company cap
      const companyKey = (candidate.company || '').trim().toLowerCase();
      if (companyKey && (companyCounts.get(companyKey) ?? 0) >= maxPerCompany) {
        continue;
      }

      // Check category slot availability — defer if this category is full
      const catId = primaryCategory(candidate);
      const maxForCat = categorySlots.get(catId) ?? 1;
      const filledForCat = categoryFilled.get(catId) ?? 0;

      if (filledForCat >= maxForCat) {
        deferred.push(candidate);
        continue;
      }

      selected.push(candidate);
      if (companyKey) {
        companyCounts.set(companyKey, (companyCounts.get(companyKey) ?? 0) + 1);
      }
      categoryFilled.set(catId, filledForCat + 1);
    }

    // Backfill remaining slots from deferred contacts (still respecting company cap)
    for (const candidate of deferred) {
      if (selected.length >= requestSlots) break;

      const companyKey = (candidate.company || '').trim().toLowerCase();
      if (companyKey && (companyCounts.get(companyKey) ?? 0) >= maxPerCompany) {
        continue;
      }

      selected.push(candidate);
      if (companyKey) {
        companyCounts.set(companyKey, (companyCounts.get(companyKey) ?? 0) + 1);
      }
    }

    // Create queue items for selected contacts
    for (const target of selected) {
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
