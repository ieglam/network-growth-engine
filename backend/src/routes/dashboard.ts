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
}
