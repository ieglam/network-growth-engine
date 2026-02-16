'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  useDashboardGrowth,
  useDashboardActivity,
  useDashboardTrends,
} from '@/hooks/useDashboard';
import type {
  DailyConnectionPoint,
  ActivityItem,
} from '@/hooks/useDashboard';

function formatDay(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const STATUS_COLORS: Record<string, string> = {
  target: 'text-gray-500 dark:text-gray-400',
  requested: 'text-blue-600 dark:text-blue-400',
  connected: 'text-green-600 dark:text-green-400',
  engaged: 'text-orange-600 dark:text-orange-400',
  relationship: 'text-purple-600 dark:text-purple-400',
};

export default function DashboardPage() {
  const { data: growthData, isLoading: growthLoading } = useDashboardGrowth();
  const { data: activityData } = useDashboardActivity();
  const { data: trendData } = useDashboardTrends();

  const growth = growthData?.data;
  const activity = activityData?.data;
  const trends = trendData?.data;

  const maxDailyVal = useMemo(() => {
    if (!trends?.dailyConnections?.length) return 1;
    return Math.max(...trends.dailyConnections.map((p: DailyConnectionPoint) => p.newConnections), 1);
  }, [trends?.dailyConnections]);

  if (growthLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>

      {/* Row 1: Snapshot Cards */}
      {growth?.snapshot && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SnapshotCard
            label="Queue Progress"
            value={`${growth.snapshot.queueCompleted ?? 0}/${growth.snapshot.queueTotal ?? 0}`}
            subtitle="completed today"
            progress={growth.snapshot.queueTotal ? (growth.snapshot.queueCompleted / growth.snapshot.queueTotal) * 100 : 0}
            progressColor="bg-blue-500"
          />
          <SnapshotCard
            label="Network Growth"
            value={`+${growth?.weeklyGrowth ?? 0} / +${growth?.monthlyGrowth ?? 0}`}
            subtitle="weekly / monthly"
          />
          <SnapshotCard
            label="Connections Sent"
            value={String(growth.snapshot.connectionsSentToday ?? 0)}
            subtitle="sent today"
          />
          <SnapshotCard
            label="Acceptance Rate"
            value={`${growth?.acceptanceRate ?? 0}%`}
            subtitle={`${growth?.totalAccepted ?? 0}/${growth?.totalSent ?? 0} all-time`}
            trend={growth?.acceptanceTrend}
          />
        </div>
      )}

      {/* Row 2: Recent Activity */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
          Recent Activity
        </h2>
        {!activity?.recentActivity?.length ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">No recent activity</p>
        ) : (
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {activity.recentActivity.map((item: ActivityItem) => (
              <Link
                key={item.id}
                href={`/contacts/${item.contactId}`}
                className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-sm text-gray-900 dark:text-white truncate">
                    {item.firstName} {item.lastName}
                  </p>
                  <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                    {item.fromStatus ? (
                      <>
                        <span className={STATUS_COLORS[item.fromStatus] || ''}>{item.fromStatus}</span>
                        {' \u2192 '}
                      </>
                    ) : null}
                    <span className={STATUS_COLORS[item.toStatus] || ''}>{item.toStatus}</span>
                  </span>
                </div>
                <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 ml-2">
                  {formatTimestamp(item.createdAt)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Row 3: Trends + Rate Limit */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: New Connections (daily chart) */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            New Connections (Daily)
          </h2>
          {!trends?.dailyConnections?.length ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">No connection data yet</p>
          ) : (
            <div className="flex items-end gap-px h-32">
              {trends.dailyConnections.map((point: DailyConnectionPoint, i: number) => {
                const height = Math.max((point.newConnections / maxDailyVal) * 100, 4);
                const showLabel = i === 0 || i === trends.dailyConnections.length - 1
                  || i % Math.max(Math.floor(trends.dailyConnections.length / 6), 1) === 0;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5 min-w-0 group relative">
                    <div
                      className="w-full bg-blue-400 dark:bg-blue-500 rounded-t hover:bg-blue-500 dark:hover:bg-blue-400 transition-colors cursor-default"
                      style={{ height: `${height}%` }}
                      title={`${formatDay(point.day)}: ${point.newConnections}`}
                    />
                    {showLabel && (
                      <span className="text-[8px] text-gray-400 dark:text-gray-500 truncate w-full text-center">
                        {formatDay(point.day)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Rate Limit Status */}
        {growth?.rateLimit && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
              Rate Limit Status
            </h2>
            <div className="space-y-4">
              <RateLimitBar
                label="Daily Usage"
                used={growth.rateLimit.dailyUsed ?? 0}
                limit={growth.rateLimit.dailyLimit ?? 20}
              />
              <RateLimitBar
                label="Weekly Usage"
                used={growth.rateLimit.weeklyUsed ?? 0}
                limit={growth.rateLimit.weeklyLimit ?? 100}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Components ---------- */

function SnapshotCard({
  label,
  value,
  subtitle,
  progress,
  progressColor,
  trend,
}: {
  label: string;
  value: string;
  subtitle: string;
  progress?: number;
  progressColor?: string;
  trend?: number;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        {label}
      </p>
      <div className="flex items-baseline gap-2 mt-1">
        <p className="text-2xl font-bold text-gray-900 dark:text-white">
          {value}
        </p>
        {trend !== undefined && trend !== 0 && (
          <span className={`text-sm font-medium ${trend > 0 ? 'text-green-600' : 'text-red-500'}`}>
            {trend > 0 ? '\u2191' : '\u2193'}{Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      {progress !== undefined && (
        <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mt-2">
          <div
            className={`h-full rounded-full ${progressColor || 'bg-blue-500'}`}
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{subtitle}</p>
    </div>
  );
}

function RateLimitBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? (used / limit) * 100 : 0;
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-green-500';

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600 dark:text-gray-400">{label}</span>
        <span className="font-medium text-gray-900 dark:text-white">{used} / {limit}</span>
      </div>
      <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}
