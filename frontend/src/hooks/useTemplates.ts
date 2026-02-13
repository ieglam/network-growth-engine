import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { Template, TemplatePreviewResult } from '@/lib/types';

export interface TemplateCreateInput {
  name: string;
  persona: string;
  subject?: string;
  body: string;
  isActive?: boolean;
}

export interface TemplateUpdateInput {
  name?: string;
  persona?: string;
  subject?: string | null;
  body?: string;
  isActive?: boolean;
}

export function useTemplates(filters?: { persona?: string; active?: boolean }) {
  const params = new URLSearchParams();
  if (filters?.persona) params.set('persona', filters.persona);
  if (filters?.active !== undefined) params.set('active', String(filters.active));
  const qs = params.toString();

  return useQuery<{ success: boolean; data: Template[] }>({
    queryKey: ['templates', qs],
    queryFn: () => apiFetch(`/templates${qs ? `?${qs}` : ''}`),
  });
}

export function useCreateTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TemplateCreateInput) => {
      return apiFetch<{ success: boolean; data: Template }>('/templates', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

export function useUpdateTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: TemplateUpdateInput }) => {
      return apiFetch<{ success: boolean; data: Template }>(`/templates/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return apiFetch(`/templates/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

export function usePreviewTemplate() {
  return useMutation({
    mutationFn: async ({ id, tokenData }: { id: string; tokenData: Record<string, string> }) => {
      return apiFetch<{ success: boolean; data: TemplatePreviewResult }>(
        `/templates/${id}/preview`,
        {
          method: 'POST',
          body: JSON.stringify(tokenData),
        }
      );
    },
  });
}
