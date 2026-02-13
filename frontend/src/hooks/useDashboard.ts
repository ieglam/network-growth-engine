import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface GrowthData {
  networkSize: number;
  goal: number;
  progressPercent: number;
  weeklyGrowth: number;
  monthlyGrowth: number;
  acceptanceRate: number;
  totalRequested: number;
  totalAccepted: number;
}

export interface CategoryBreakdown {
  id: string;
  name: string;
  relevanceWeight: number;
  totalContacts: number;
  statusBreakdown: Record<string, number>;
}

export interface CategoriesData {
  categories: CategoryBreakdown[];
  uncategorized: number;
}

export interface ScoreDistribution {
  cold: number;
  warm: number;
  active: number;
  strong: number;
  total: number;
}

export interface GoingColdContact {
  id: string;
  firstName: string;
  lastName: string;
  currentScore: number;
  previousScore: number;
  drop: number;
}

export interface TopRelationship {
  id: string;
  firstName: string;
  lastName: string;
  company: string | null;
  relationshipScore: number;
  status: string;
}

export interface ScoresData {
  distribution: ScoreDistribution;
  topRelationships: TopRelationship[];
  goingCold: GoingColdContact[];
}

export interface TrendPoint {
  week: string;
  newConnections: number;
}

export interface ScoreTrendPoint {
  week: string;
  avgScore: number;
}

export interface QueueTrendPoint {
  week: string;
  total: number;
  executed: number;
  executionRate: number;
}

export interface TrendsData {
  networkGrowth: TrendPoint[];
  averageScore: ScoreTrendPoint[];
  queueExecution: QueueTrendPoint[];
}

export function useDashboardGrowth() {
  return useQuery<{ success: boolean; data: GrowthData }>({
    queryKey: ['dashboard-growth'],
    queryFn: () => apiFetch('/dashboard/growth'),
  });
}

export function useDashboardCategories() {
  return useQuery<{ success: boolean; data: CategoriesData }>({
    queryKey: ['dashboard-categories'],
    queryFn: () => apiFetch('/dashboard/categories'),
  });
}

export function useDashboardScores() {
  return useQuery<{ success: boolean; data: ScoresData }>({
    queryKey: ['dashboard-scores'],
    queryFn: () => apiFetch('/dashboard/scores'),
  });
}

export function useDashboardTrends() {
  return useQuery<{ success: boolean; data: TrendsData }>({
    queryKey: ['dashboard-trends'],
    queryFn: () => apiFetch('/dashboard/trends'),
  });
}
