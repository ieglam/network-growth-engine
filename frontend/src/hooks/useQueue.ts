import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { QueueItem, QueueSummary } from '@/lib/types';

export function useQueueToday() {
  return useQuery<{ success: boolean; data: QueueItem[] }>({
    queryKey: ['queue-today'],
    queryFn: () => apiFetch('/queue/today'),
  });
}

export function useQueueSummary() {
  return useQuery<{ success: boolean; data: QueueSummary }>({
    queryKey: ['queue-summary'],
    queryFn: () => apiFetch('/queue/summary'),
  });
}

export function useMarkDone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) => {
      return apiFetch(`/queue/${id}/done`, {
        method: 'PUT',
        body: JSON.stringify({ notes }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue-today'] });
      queryClient.invalidateQueries({ queryKey: ['queue-summary'] });
    },
  });
}

export function useSkipItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      return apiFetch(`/queue/${id}/skip`, {
        method: 'PUT',
        body: JSON.stringify({ reason }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue-today'] });
      queryClient.invalidateQueries({ queryKey: ['queue-summary'] });
    },
  });
}

export function useSnoozeItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, snoozeUntil }: { id: string; snoozeUntil: string }) => {
      return apiFetch(`/queue/${id}/snooze`, {
        method: 'PUT',
        body: JSON.stringify({ snoozeUntil }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue-today'] });
      queryClient.invalidateQueries({ queryKey: ['queue-summary'] });
    },
  });
}

export function useBatchApprove() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids }: { ids: string[] }) => {
      return apiFetch('/queue/approve', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue-today'] });
      queryClient.invalidateQueries({ queryKey: ['queue-summary'] });
    },
  });
}
