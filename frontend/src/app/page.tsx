'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  useDashboardGrowth,
  useDashboardCategories,
  useDashboardScores,
  useDashboardTrends,
} from '@/hooks/useDashboard';
import type { TrendPoint } from '@/hooks/useDashboard';

const BAND_COLORS = {
  cold: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300' },
  warm: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-300' },
  active: {
    bg: 'bg-orange-100 dark:bg-orange-900/30',
    text: 'text-orange-700 dark:text-orange-300',
  },
  strong: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-700 dark:text-green-300',
  },
} as const;

function formatWeek(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function DashboardPage() {
  const { data: growthData, isLoading: growthLoading } = useDashboardGrowth();
  const { data: catData } = useDashboardCategories();
  const { data: scoreData } = useDashboardScores();
  const { data: trendData } = useDashboardTrends();

  const growth = growthData?.data;
  const categories = catData?.data;
  const scores = scoreData?.data;
  const trends = trendData?.data;

  const maxTrendVal = useMemo(() => {
    if (!trends?.networkGrowth?.length) return 1;
    return Math.max(...trends.networkGrowth.map((p: TrendPoint) => p.newConnections), 1);
  }, [trends?.networkGrowth]);

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

      {/* Network Progress */}
      {growth && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Network Growth
            </h2>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {growth.networkSize.toLocaleString()} / {growth.goal.toLocaleString()}
            </span>
          </div>
          <div className="w-full h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-green-500 rounded-full transition-all"
              style={{ width: `${Math.min(growth.progressPercent, 100)}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {growth.progressPercent}% of goal
          </p>
        </div>
      )}

      {/* Metric Cards */}
      {growth && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="Weekly Growth"
            value={`+${growth.weeklyGrowth}`}
            subtitle="new connections (7d)"
          />
          <MetricCard
            label="Monthly Growth"
            value={`+${growth.monthlyGrowth}`}
            subtitle="new connections (30d)"
          />
          <MetricCard
            label="Acceptance Rate"
            value={`${growth.acceptanceRate}%`}
            subtitle={`${growth.totalAccepted} / ${growth.totalRequested} sent`}
          />
          <MetricCard
            label="Rate Limit"
            value={`${growth.weeklyGrowth}/100`}
            subtitle="weekly requests used"
          />
        </div>
      )}

      {/* Score Distribution */}
      {scores && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            Score Distribution
          </h2>
          <div className="grid grid-cols-4 gap-3">
            {(Object.keys(BAND_COLORS) as (keyof typeof BAND_COLORS)[]).map((band) => {
              const count = scores.distribution[band];
              const pct =
                scores.distribution.total > 0
                  ? Math.round((count / scores.distribution.total) * 100)
                  : 0;
              return (
                <div key={band} className={`rounded-lg p-3 text-center ${BAND_COLORS[band].bg}`}>
                  <p className={`text-2xl font-bold ${BAND_COLORS[band].text}`}>{count}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                    {band} ({pct}%)
                  </p>
                </div>
              );
            })}
          </div>
          {/* Bar chart representation */}
          {scores.distribution.total > 0 && (
            <div className="flex mt-3 h-3 rounded-full overflow-hidden">
              {(Object.keys(BAND_COLORS) as (keyof typeof BAND_COLORS)[]).map((band) => {
                const pct = (scores.distribution[band] / scores.distribution.total) * 100;
                if (pct === 0) return null;
                const colors: Record<string, string> = {
                  cold: 'bg-blue-400',
                  warm: 'bg-yellow-400',
                  active: 'bg-orange-400',
                  strong: 'bg-green-400',
                };
                return <div key={band} className={colors[band]} style={{ width: `${pct}%` }} />;
              })}
            </div>
          )}
        </div>
      )}

      {/* Category Breakdown + Going Cold */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Category Breakdown */}
        {categories && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Category Breakdown
            </h2>
            {categories.categories.length === 0 && categories.uncategorized === 0 ? (
              <p className="text-sm text-gray-400">No contacts yet</p>
            ) : (
              <div className="space-y-2">
                {categories.categories.map((cat) => {
                  const totalAll = categories.categories.reduce(
                    (sum, c) => sum + c.totalContacts,
                    categories.uncategorized
                  );
                  const pct = totalAll > 0 ? Math.round((cat.totalContacts / totalAll) * 100) : 0;
                  return (
                    <div key={cat.id}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700 dark:text-gray-300">{cat.name}</span>
                        <span className="text-gray-500 dark:text-gray-400">
                          {cat.totalContacts} ({pct}%)
                        </span>
                      </div>
                      <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full mt-1">
                        <div
                          className="h-full bg-blue-500 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                {categories.uncategorized > 0 && (
                  <div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400 italic">Uncategorized</span>
                      <span className="text-gray-500 dark:text-gray-400">
                        {categories.uncategorized}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Going Cold Alerts */}
        {scores && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Going Cold Alerts
            </h2>
            {scores.goingCold.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">
                No contacts going cold right now
              </p>
            ) : (
              <div className="space-y-2">
                {scores.goingCold.map((c) => (
                  <Link
                    key={c.id}
                    href={`/contacts/${c.id}`}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {c.firstName} {c.lastName}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Score: {c.currentScore} (was {c.previousScore})
                      </p>
                    </div>
                    <span className="text-sm font-medium text-red-600 dark:text-red-400">
                      -{c.drop}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Network Growth Trend */}
      {trends && trends.networkGrowth.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            New Connections (12 weeks)
          </h2>
          <div className="flex items-end gap-1 h-32">
            {trends.networkGrowth.map((point, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                  {point.newConnections}
                </span>
                <div
                  className="w-full bg-blue-400 dark:bg-blue-500 rounded-t"
                  style={{
                    height: `${Math.max((point.newConnections / maxTrendVal) * 100, 4)}%`,
                  }}
                />
                <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate w-full text-center">
                  {formatWeek(point.week)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rate Limit Status */}
      {growth && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Rate Limit Status
          </h2>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                <span>Weekly Usage</span>
                <span>{growth.weeklyGrowth} / 100</span>
              </div>
              <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    growth.weeklyGrowth >= 90
                      ? 'bg-red-500'
                      : growth.weeklyGrowth >= 70
                        ? 'bg-yellow-500'
                        : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(growth.weeklyGrowth, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        {label}
      </p>
      <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
    </div>
  );
}
