import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface SnapshotData {
  queueCompleted: number;
  queueTotal: number;
  pendingActions: number;
  connectionsSentToday: number;
}

export interface RateLimitData {
  dailyUsed: number;
  dailyLimit: number;
  weeklyUsed: number;
  weeklyLimit: number;
}

export interface GrowthData {
  snapshot: SnapshotData;
  acceptanceRate: number;
  acceptanceTrend: number;
  totalSent: number;
  totalAccepted: number;
  rateLimit: RateLimitData;
  networkSize: number;
  weeklyGrowth: number;
  monthlyGrowth: number;
}

export interface ActivityItem {
  id: string;
  contactId: string;
  firstName: string;
  lastName: string;
  fromStatus: string;
  toStatus: string;
  createdAt: string;
}

export interface ActivityData {
  recentActivity: ActivityItem[];
}

export interface DailyConnectionPoint {
  day: string;
  newConnections: number;
}

export interface TrendsData {
  dailyConnections: DailyConnectionPoint[];
}

export function useDashboardGrowth() {
  return useQuery<{ success: boolean; data: GrowthData }>({
    queryKey: ['dashboard-growth'],
    queryFn: () => apiFetch('/dashboard/growth'),
  });
}

export function useDashboardActivity() {
  return useQuery<{ success: boolean; data: ActivityData }>({
    queryKey: ['dashboard-activity'],
    queryFn: () => apiFetch('/dashboard/activity'),
  });
}

export function useDashboardTrends() {
  return useQuery<{ success: boolean; data: TrendsData }>({
    queryKey: ['dashboard-trends'],
    queryFn: () => apiFetch('/dashboard/trends'),
  });
}
