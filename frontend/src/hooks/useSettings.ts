import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export function useSettings() {
  return useQuery<{ success: boolean; data: Record<string, string> }>({
    queryKey: ['settings'],
    queryFn: () => apiFetch('/settings'),
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updates: Record<string, string>) => {
      return apiFetch<{ success: boolean; data: { updated: Record<string, string> } }>(
        '/settings',
        {
          method: 'PUT',
          body: JSON.stringify(updates),
        }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-growth'] });
    },
  });
}
