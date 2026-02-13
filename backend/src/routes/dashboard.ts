import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { prisma } from '../lib/prisma.js';

const DEFAULT_NETWORK_GOAL = 7000;

const SCORE_BANDS = {
  cold: { min: 0, max: 20 },
  warm: { min: 21, max: 50 },
  active: { min: 51, max: 75 },
  strong: { min: 76, max: 100 },
} as const;

export async function dashboardRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  // GET /api/dashboard/growth — Network size vs goal, growth rate, acceptance rate
  fastify.get('/dashboard/growth', async () => {
    const goalSetting = await prisma.settings.findUnique({
      where: { key: 'network_goal' },
    });
    const goal = goalSetting ? parseInt(goalSetting.value, 10) : DEFAULT_NETWORK_GOAL;

    // Current network size: connected + engaged + relationship
    const networkSize = await prisma.contact.count({
      where: {
        deletedAt: null,
        status: { in: ['connected', 'engaged', 'relationship'] },
      },
    });

    // Growth rate: new connections in last 7 and 30 days (status transitions to connected)
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [weeklyGrowth, monthlyGrowth] = await Promise.all([
      prisma.statusHistory.count({
        where: {
          toStatus: 'connected',
          createdAt: { gte: sevenDaysAgo },
        },
      }),
      prisma.statusHistory.count({
        where: {
          toStatus: 'connected',
          createdAt: { gte: thirtyDaysAgo },
        },
      }),
    ]);

    // Acceptance rate: connected / requested (all time)
    const [totalRequested, totalAccepted] = await Promise.all([
      prisma.statusHistory.count({
        where: { toStatus: 'requested' },
      }),
      prisma.statusHistory.count({
        where: {
          fromStatus: 'requested',
          toStatus: 'connected',
        },
      }),
    ]);

    const acceptanceRate = totalRequested > 0 ? totalAccepted / totalRequested : 0;

    return {
      success: true,
      data: {
        networkSize,
        goal,
        progressPercent: goal > 0 ? Math.round((networkSize / goal) * 10000) / 100 : 0,
        weeklyGrowth,
        monthlyGrowth,
        acceptanceRate: Math.round(acceptanceRate * 10000) / 100,
        totalRequested,
        totalAccepted,
      },
    };
  });

  // GET /api/dashboard/categories — Breakdown by category
  fastify.get('/dashboard/categories', async () => {
    const categories = await prisma.category.findMany({
      include: {
        contacts: {
          include: {
            contact: {
              select: { id: true, status: true, deletedAt: true },
            },
          },
        },
      },
    });

    const breakdown = categories.map((cat) => {
      const activeContacts = cat.contacts.filter((cc) => cc.contact.deletedAt === null);
      const statusCounts: Record<string, number> = {};
      for (const cc of activeContacts) {
        statusCounts[cc.contact.status] = (statusCounts[cc.contact.status] || 0) + 1;
      }

      return {
        id: cat.id,
        name: cat.name,
        relevanceWeight: cat.relevanceWeight,
        totalContacts: activeContacts.length,
        statusBreakdown: statusCounts,
      };
    });

    // Also count uncategorized contacts
    const uncategorizedCount = await prisma.contact.count({
      where: {
        deletedAt: null,
        categories: { none: {} },
      },
    });

    return {
      success: true,
      data: {
        categories: breakdown,
        uncategorized: uncategorizedCount,
      },
    };
  });

  // GET /api/dashboard/scores — Distribution by relationship score band
  fastify.get('/dashboard/scores', async () => {
    const [cold, warm, active, strong] = await Promise.all([
      prisma.contact.count({
        where: {
          deletedAt: null,
          status: { in: ['connected', 'engaged', 'relationship'] },
          relationshipScore: { gte: SCORE_BANDS.cold.min, lte: SCORE_BANDS.cold.max },
        },
      }),
      prisma.contact.count({
        where: {
          deletedAt: null,
          status: { in: ['connected', 'engaged', 'relationship'] },
          relationshipScore: { gte: SCORE_BANDS.warm.min, lte: SCORE_BANDS.warm.max },
        },
      }),
      prisma.contact.count({
        where: {
          deletedAt: null,
          status: { in: ['connected', 'engaged', 'relationship'] },
          relationshipScore: { gte: SCORE_BANDS.active.min, lte: SCORE_BANDS.active.max },
        },
      }),
      prisma.contact.count({
        where: {
          deletedAt: null,
          status: { in: ['connected', 'engaged', 'relationship'] },
          relationshipScore: { gte: SCORE_BANDS.strong.min, lte: SCORE_BANDS.strong.max },
        },
      }),
    ]);

    // Top 10 strongest relationships
    const topRelationships = await prisma.contact.findMany({
      where: {
        deletedAt: null,
        status: { in: ['connected', 'engaged', 'relationship'] },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        company: true,
        relationshipScore: true,
        status: true,
      },
      orderBy: { relationshipScore: 'desc' },
      take: 10,
    });

    // "Going cold" alerts: contacts with score drop > 15 in last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const goingCold = await prisma.$queryRaw<
      {
        id: string;
        first_name: string;
        last_name: string;
        relationship_score: number;
        old_score: number;
      }[]
    >`
      SELECT c.id, c.first_name, c.last_name, c.relationship_score,
             sh.score_value::int AS old_score
      FROM contacts c
      JOIN score_history sh ON sh.contact_id = c.id
      WHERE c.deleted_at IS NULL
        AND c.status IN ('connected', 'engaged', 'relationship')
        AND sh.score_type = 'relationship'
        AND sh.recorded_at >= ${thirtyDaysAgo}::date
        AND sh.score_value - c.relationship_score > 15
      ORDER BY (sh.score_value - c.relationship_score) DESC
      LIMIT 10
    `;

    return {
      success: true,
      data: {
        distribution: {
          cold,
          warm,
          active,
          strong,
          total: cold + warm + active + strong,
        },
        topRelationships,
        goingCold: goingCold.map((c) => ({
          id: c.id,
          firstName: c.first_name,
          lastName: c.last_name,
          currentScore: c.relationship_score,
          previousScore: c.old_score,
          drop: c.old_score - c.relationship_score,
        })),
      },
    };
  });

  // GET /api/dashboard/trends — Time series data for charts
  fastify.get('/dashboard/trends', async () => {
    // Network size over time (last 12 weeks, weekly buckets)
    const twelveWeeksAgo = new Date();
    twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84);

    const networkGrowthTrend = await prisma.$queryRaw<{ week: Date; new_connections: bigint }[]>`
      SELECT date_trunc('week', created_at) AS week,
             COUNT(*) AS new_connections
      FROM status_history
      WHERE to_status = 'connected'
        AND created_at >= ${twelveWeeksAgo}
      GROUP BY date_trunc('week', created_at)
      ORDER BY week ASC
    `;

    // Average relationship score trend (last 12 weeks)
    const scoreTrend = await prisma.$queryRaw<{ week: Date; avg_score: number }[]>`
      SELECT date_trunc('week', recorded_at) AS week,
             ROUND(AVG(score_value), 1) AS avg_score
      FROM score_history
      WHERE score_type = 'relationship'
        AND recorded_at >= ${twelveWeeksAgo}::date
      GROUP BY date_trunc('week', recorded_at)
      ORDER BY week ASC
    `;

    // Queue execution rate (last 12 weeks)
    const queueTrend = await prisma.$queryRaw<{ week: Date; total: bigint; executed: bigint }[]>`
      SELECT date_trunc('week', queue_date) AS week,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE status = 'executed') AS executed
      FROM queue_items
      WHERE queue_date >= ${twelveWeeksAgo}::date
      GROUP BY date_trunc('week', queue_date)
      ORDER BY week ASC
    `;

    return {
      success: true,
      data: {
        networkGrowth: networkGrowthTrend.map((r) => ({
          week: r.week,
          newConnections: Number(r.new_connections),
        })),
        averageScore: scoreTrend.map((r) => ({
          week: r.week,
          avgScore: Number(r.avg_score),
        })),
        queueExecution: queueTrend.map((r) => ({
          week: r.week,
          total: Number(r.total),
          executed: Number(r.executed),
          executionRate:
            Number(r.total) > 0 ? Math.round((Number(r.executed) / Number(r.total)) * 100) : 0,
        })),
      },
    };
  });
}
