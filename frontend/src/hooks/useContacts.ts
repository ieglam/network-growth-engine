import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { ContactListResponse, Category, Tag } from '@/lib/types';

export interface ContactFilters {
  q?: string;
  status?: string;
  category?: string;
  tag?: string;
  scoreMin?: number;
  scoreMax?: number;
  location?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}

function buildQueryString(filters: ContactFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.status) params.set('status', filters.status);
  if (filters.category) params.set('category', filters.category);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.scoreMin !== undefined) params.set('scoreMin', String(filters.scoreMin));
  if (filters.scoreMax !== undefined) params.set('scoreMax', String(filters.scoreMax));
  if (filters.location) params.set('location', filters.location);
  if (filters.sort) params.set('sort', filters.sort);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  return params.toString();
}

export function useContacts(filters: ContactFilters) {
  const qs = buildQueryString(filters);
  return useQuery<ContactListResponse>({
    queryKey: ['contacts', qs],
    queryFn: () => apiFetch<ContactListResponse>(`/contacts?${qs}`),
  });
}

export function useCategories() {
  return useQuery<{ success: boolean; data: Category[] }>({
    queryKey: ['categories'],
    queryFn: () => apiFetch('/categories'),
  });
}

export function useTags() {
  return useQuery<{ success: boolean; data: Tag[] }>({
    queryKey: ['tags'],
    queryFn: () => apiFetch('/tags'),
  });
}

export function useBulkAddTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ contactIds, tagId }: { contactIds: string[]; tagId: string }) => {
      await Promise.all(
        contactIds.map((id) =>
          apiFetch(`/contacts/${id}/tags`, {
            method: 'POST',
            body: JSON.stringify({ tagId }),
          })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}

export function useBulkRemoveTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ contactIds, tagId }: { contactIds: string[]; tagId: string }) => {
      await Promise.all(
        contactIds.map((id) =>
          apiFetch(`/contacts/${id}/tags/${tagId}`, {
            method: 'DELETE',
          })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}
