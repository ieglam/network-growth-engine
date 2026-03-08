import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { prisma } from '../lib/prisma.js';

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function dashboardRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  // GET /api/dashboard/growth — Snapshot, pipeline, rate limits, acceptance rate
  fastify.get('/dashboard/growth', async () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const weekStart = getWeekStart(now);

    // --- Today's Snapshot ---
    const [todayExecuted, todayTotal, todayPending, todayApproved] = await Promise.all([
      prisma.queueItem.count({
        where: { queueDate: today, status: 'executed' },
      }),
      prisma.queueItem.count({
        where: { queueDate: today },
      }),
      prisma.queueItem.count({
        where: { queueDate: today, status: 'pending' },
      }),
      prisma.queueItem.count({
        where: { queueDate: today, status: 'approved' },
      }),
    ]);

    // Connections sent today (queue items with action_type connection_request marked done)
    const connectionsSentToday = await prisma.queueItem.count({
      where: {
        queueDate: today,
        actionType: 'connection_request',
        status: 'executed',
      },
    });

    // --- Acceptance Rate (all-time) ---
    // Sent = all queue items of type connection_request marked done (executed)
    const totalSent = await prisma.queueItem.count({
      where: {
        actionType: 'connection_request',
        status: 'executed',
      },
    });

    // Accepted = status transitions from requested → connected
    const totalAccepted = await prisma.statusHistory.count({
      where: {
        fromStatus: 'requested',
        toStatus: 'connected',
      },
    });

    const acceptanceRate = totalSent > 0 ? Math.round((totalAccepted / totalSent) * 10000) / 100 : 0;

    // Acceptance rate last week (for trend arrow)
    const lastWeekSent = await prisma.queueItem.count({
      where: {
        actionType: 'connection_request',
        status: 'executed',
        executedAt: { lt: sevenDaysAgo },
      },
    });
    const lastWeekAccepted = await prisma.statusHistory.count({
      where: {
        fromStatus: 'requested',
        toStatus: 'connected',
        createdAt: { lt: sevenDaysAgo },
      },
    });
    const lastWeekRate = lastWeekSent > 0 ? (lastWeekAccepted / lastWeekSent) * 100 : 0;
    const acceptanceTrend = acceptanceRate - Math.round(lastWeekRate * 100) / 100;

    // --- Network Size ---
    const [connected, engaged, relationship] = await Promise.all([
      prisma.contact.count({ where: { deletedAt: null, status: 'connected' } }),
      prisma.contact.count({ where: { deletedAt: null, status: 'engaged' } }),
      prisma.contact.count({ where: { deletedAt: null, status: 'relationship' } }),
    ]);

    // --- Rate Limits ---
    // Daily: connection requests executed today out of 20
    const dailyUsed = connectionsSentToday;
    const dailyLimit = 20;

    // Weekly: connection requests executed this week out of 100
    const weeklyUsed = await prisma.queueItem.count({
      where: {
        actionType: 'connection_request',
        status: 'executed',
        executedAt: { gte: weekStart },
      },
    });
    const weeklyLimit = 100;

    // --- Growth ---
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [weeklyGrowth, monthlyGrowth] = await Promise.all([
      prisma.statusHistory.count({
        where: { toStatus: 'connected', createdAt: { gte: sevenDaysAgo } },
      }),
      prisma.statusHistory.count({
        where: { toStatus: 'connected', createdAt: { gte: thirtyDaysAgo } },
      }),
    ]);

    const networkSize = connected + engaged + relationship;

    // --- Pending Requests (sent but not yet accepted/rejected) ---
    const pendingRequests = await prisma.contact.count({
      where: { deletedAt: null, status: 'requested' },
    });

    return {
      success: true,
      data: {
        snapshot: {
          queueCompleted: todayExecuted,
          queueTotal: todayTotal,
          pendingActions: todayPending + todayApproved,
          connectionsSentToday,
        },
        acceptanceRate,
        acceptanceTrend,
        totalSent,
        totalAccepted,
        pendingRequests,
        rateLimit: {
          dailyUsed,
          dailyLimit,
          weeklyUsed,
          weeklyLimit,
        },
        networkSize,
        weeklyGrowth,
        monthlyGrowth,
      },
    };
  });

  // GET /api/dashboard/activity — Recent status changes
  fastify.get('/dashboard/activity', async () => {
    const recentActivity = await prisma.$queryRaw<
      {
        id: string;
        contact_id: string;
        first_name: string;
        last_name: string;
        from_status: string;
        to_status: string;
        created_at: Date;
      }[]
    >`
      SELECT sh.id, sh.contact_id, c.first_name, c.last_name,
             sh.from_status, sh.to_status, sh.created_at
      FROM status_history sh
      JOIN contacts c ON c.id = sh.contact_id
      WHERE c.deleted_at IS NULL
        AND sh.from_status IS NOT NULL
      ORDER BY sh.created_at DESC
      LIMIT 20
    `;

    return {
      success: true,
      data: {
        recentActivity: recentActivity.map((r) => ({
          id: r.id,
          contactId: r.contact_id,
          firstName: r.first_name,
          lastName: r.last_name,
          fromStatus: r.from_status,
          toStatus: r.to_status,
          createdAt: r.created_at,
        })),
      },
    };
  });

  // GET /api/dashboard/trends — Daily new connections (last 12 weeks)
  fastify.get('/dashboard/trends', async () => {
    const twelveWeeksAgo = new Date();
    twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84);

    const dailyConnections = await prisma.$queryRaw<{ day: Date; new_connections: bigint }[]>`
      SELECT date_trunc('day', created_at) AS day,
             COUNT(*) AS new_connections
      FROM status_history
      WHERE to_status = 'connected'
        AND created_at >= ${twelveWeeksAgo}
      GROUP BY date_trunc('day', created_at)
      ORDER BY day ASC
    `;

    return {
      success: true,
      data: {
        dailyConnections: dailyConnections.map((r) => ({
          day: r.day,
          newConnections: Number(r.new_connections),
        })),
      },
    };
  });

  // GET /api/dashboard/conversion — Acceptance rate trends, by category, by template
  fastify.get('/dashboard/conversion', async () => {
    const now = new Date();
    const eightWeeksAgo = new Date(now);
    eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 1. Weekly acceptance rate (last 8 weeks)
    const weeklySent = await prisma.$queryRaw<{ week: Date; count: bigint }[]>`
      SELECT date_trunc('week', executed_at) AS week, COUNT(*) AS count
      FROM queue_items
      WHERE action_type = 'connection_request'
        AND status = 'executed'
        AND executed_at >= ${eightWeeksAgo}
      GROUP BY date_trunc('week', executed_at)
      ORDER BY week ASC
    `;

    const weeklyAccepted = await prisma.$queryRaw<{ week: Date; count: bigint }[]>`
      SELECT date_trunc('week', created_at) AS week, COUNT(*) AS count
      FROM status_history
      WHERE from_status = 'requested'
        AND to_status = 'connected'
        AND created_at >= ${eightWeeksAgo}
      GROUP BY date_trunc('week', created_at)
      ORDER BY week ASC
    `;

    const sentByWeek = new Map(weeklySent.map((r) => [r.week.toISOString(), Number(r.count)]));
    const acceptedByWeek = new Map(weeklyAccepted.map((r) => [r.week.toISOString(), Number(r.count)]));
    const allWeeks = [...new Set([...sentByWeek.keys(), ...acceptedByWeek.keys()])].sort();

    const weeklyAcceptanceRate = allWeeks.map((w) => {
      const sent = sentByWeek.get(w) ?? 0;
      const accepted = acceptedByWeek.get(w) ?? 0;
      return {
        week: w,
        sent,
        accepted,
        rate: sent > 0 ? Math.round((accepted / sent) * 10000) / 100 : 0,
      };
    });

    // 2. Connections sent per day (last 30 days)
    const dailySent = await prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT date_trunc('day', executed_at) AS day, COUNT(*) AS count
      FROM queue_items
      WHERE action_type = 'connection_request'
        AND status = 'executed'
        AND executed_at >= ${thirtyDaysAgo}
      GROUP BY date_trunc('day', executed_at)
      ORDER BY day ASC
    `;

    // 3. Acceptance rate by category
    const byCategory = await prisma.$queryRaw<
      { category_name: string; sent: bigint; accepted: bigint }[]
    >`
      WITH sent AS (
        SELECT cat.name AS category_name, COUNT(DISTINCT qi.id) AS cnt
        FROM queue_items qi
        JOIN contacts c ON c.id = qi.contact_id
        JOIN contact_categories cc ON cc.contact_id = c.id
        JOIN categories cat ON cat.id = cc.category_id
        WHERE qi.action_type = 'connection_request'
          AND qi.status = 'executed'
          AND c.deleted_at IS NULL
        GROUP BY cat.name
      ),
      accepted AS (
        SELECT cat.name AS category_name, COUNT(DISTINCT sh.id) AS cnt
        FROM status_history sh
        JOIN contacts c ON c.id = sh.contact_id
        JOIN contact_categories cc ON cc.contact_id = c.id
        JOIN categories cat ON cat.id = cc.category_id
        WHERE sh.from_status = 'requested'
          AND sh.to_status = 'connected'
          AND c.deleted_at IS NULL
        GROUP BY cat.name
      )
      SELECT
        COALESCE(s.category_name, a.category_name) AS category_name,
        COALESCE(s.cnt, 0) AS sent,
        COALESCE(a.cnt, 0) AS accepted
      FROM sent s
      FULL OUTER JOIN accepted a ON s.category_name = a.category_name
      ORDER BY COALESCE(s.cnt, 0) DESC
    `;

    // 4. Acceptance rate by template
    const byTemplate = await prisma.$queryRaw<
      { template_name: string; sent: bigint; accepted: bigint }[]
    >`
      WITH sent AS (
        SELECT COALESCE(t.name, 'No Template') AS template_name, COUNT(DISTINCT qi.id) AS cnt
        FROM queue_items qi
        LEFT JOIN templates t ON t.id = qi.template_id
        WHERE qi.action_type = 'connection_request'
          AND qi.status = 'executed'
        GROUP BY COALESCE(t.name, 'No Template')
      ),
      accepted AS (
        SELECT COALESCE(t.name, 'No Template') AS template_name, COUNT(DISTINCT sh.id) AS cnt
        FROM queue_items qi
        LEFT JOIN templates t ON t.id = qi.template_id
        JOIN status_history sh ON sh.contact_id = qi.contact_id
          AND sh.from_status = 'requested'
          AND sh.to_status = 'connected'
        WHERE qi.action_type = 'connection_request'
          AND qi.status = 'executed'
        GROUP BY COALESCE(t.name, 'No Template')
      )
      SELECT
        COALESCE(s.template_name, a.template_name) AS template_name,
        COALESCE(s.cnt, 0) AS sent,
        COALESCE(a.cnt, 0) AS accepted
      FROM sent s
      FULL OUTER JOIN accepted a ON s.template_name = a.template_name
      ORDER BY COALESCE(s.cnt, 0) DESC
    `;

    return {
      success: true,
      data: {
        weeklyAcceptanceRate,
        dailySent: dailySent.map((r) => ({
          day: r.day,
          count: Number(r.count),
        })),
        byCategory: byCategory.map((r) => ({
          category: r.category_name,
          sent: Number(r.sent),
          accepted: Number(r.accepted),
          rate: Number(r.sent) > 0 ? Math.round((Number(r.accepted) / Number(r.sent)) * 10000) / 100 : 0,
        })),
        byTemplate: byTemplate.map((r) => ({
          template: r.template_name,
          sent: Number(r.sent),
          accepted: Number(r.accepted),
          rate: Number(r.sent) > 0 ? Math.round((Number(r.accepted) / Number(r.sent)) * 10000) / 100 : 0,
        })),
      },
    };
  });
}
