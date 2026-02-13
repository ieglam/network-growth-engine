import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { DuplicatePair } from '../lib/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

async function fetchDuplicates(
  status: string = 'pending'
): Promise<{ success: boolean; data: DuplicatePair[] }> {
  const res = await fetch(`${API_BASE}/duplicates?status=${status}`);
  if (!res.ok) throw new Error('Failed to fetch duplicates');
  return res.json();
}

async function scanDuplicates(): Promise<{
  success: boolean;
  data: { autoMerged: number; flagged: number };
}> {
  const res = await fetch(`${API_BASE}/duplicates/scan`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to run scan');
  return res.json();
}

async function mergeDuplicatePair(
  pairId: string,
  primaryContactId: string
): Promise<{ success: boolean; data: { message: string; primaryContactId: string } }> {
  const res = await fetch(`${API_BASE}/duplicates/${pairId}/merge`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ primaryContactId }),
  });
  if (!res.ok) throw new Error('Failed to merge');
  return res.json();
}

async function dismissDuplicatePair(
  pairId: string
): Promise<{ success: boolean; data: { message: string } }> {
  const res = await fetch(`${API_BASE}/duplicates/${pairId}/dismiss`, {
    method: 'PUT',
  });
  if (!res.ok) throw new Error('Failed to dismiss');
  return res.json();
}

export function useDuplicates(status: string = 'pending') {
  return useQuery({
    queryKey: ['duplicates', status],
    queryFn: () => fetchDuplicates(status),
  });
}

export function useScanDuplicates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: scanDuplicates,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['duplicates'] });
    },
  });
}

export function useMergeDuplicate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pairId, primaryContactId }: { pairId: string; primaryContactId: string }) =>
      mergeDuplicatePair(pairId, primaryContactId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}

export function useDismissDuplicate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pairId: string) => dismissDuplicatePair(pairId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['duplicates'] });
    },
  });
}
