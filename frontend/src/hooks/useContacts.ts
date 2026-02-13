import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type {
  ContactListResponse,
  ContactDetailResponse,
  Category,
  Tag,
  Interaction,
} from '@/lib/types';

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

export function useContact(id: string) {
  return useQuery<ContactDetailResponse>({
    queryKey: ['contact', id],
    queryFn: () => apiFetch<ContactDetailResponse>(`/contacts/${id}`),
    enabled: !!id,
  });
}

export function useContactInteractions(contactId: string) {
  return useQuery<{ success: boolean; data: Interaction[] }>({
    queryKey: ['contact-interactions', contactId],
    queryFn: () => apiFetch(`/contacts/${contactId}/interactions`),
    enabled: !!contactId,
  });
}

export function useUpdateContactStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contactId,
      status,
      reason,
    }: {
      contactId: string;
      status: string;
      reason?: string;
    }) => {
      return apiFetch(`/contacts/${contactId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status, reason }),
      });
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['contact', vars.contactId] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
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

export interface ContactCreateInput {
  firstName: string;
  lastName: string;
  title?: string;
  company?: string;
  linkedinUrl?: string;
  email?: string;
  phone?: string;
  location?: string;
  headline?: string;
  status?: string;
  seniority?: string;
  notes?: string;
  introductionSource?: string;
  mutualConnectionsCount?: number;
  isActiveOnLinkedin?: boolean;
  hasOpenToConnect?: boolean;
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contact,
      categoryIds,
      tagNames,
    }: {
      contact: ContactCreateInput;
      categoryIds: string[];
      tagNames: string[];
    }) => {
      // Clean empty strings to null
      const cleaned: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(contact)) {
        cleaned[key] = value === '' ? undefined : value;
      }

      const res = await apiFetch<ContactDetailResponse>('/contacts', {
        method: 'POST',
        body: JSON.stringify(cleaned),
      });

      const id = res.data.id;

      // Assign categories
      if (categoryIds.length > 0) {
        await apiFetch(`/contacts/${id}/categories`, {
          method: 'POST',
          body: JSON.stringify({ categoryIds }),
        });
      }

      // Assign tags
      if (tagNames.length > 0) {
        await apiFetch(`/contacts/${id}/tags`, {
          method: 'POST',
          body: JSON.stringify({ tags: tagNames }),
        });
      }

      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}

export function useUpdateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contactId,
      contact,
      categoryIds,
      tagNames,
    }: {
      contactId: string;
      contact: Partial<ContactCreateInput>;
      categoryIds: string[];
      tagNames: string[];
    }) => {
      // Clean empty strings to null
      const cleaned: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(contact)) {
        cleaned[key] = value === '' ? null : value;
      }

      const res = await apiFetch<ContactDetailResponse>(`/contacts/${contactId}`, {
        method: 'PUT',
        body: JSON.stringify(cleaned),
      });

      // Replace categories: delete all, then assign new ones
      const existing = await apiFetch<ContactDetailResponse>(`/contacts/${contactId}`);
      const existingCatIds = existing.data.categories.map((cc) => cc.categoryId);

      // Remove categories no longer selected
      const toRemoveCats = existingCatIds.filter((id) => !categoryIds.includes(id));
      for (const catId of toRemoveCats) {
        await apiFetch(`/contacts/${contactId}/categories/${catId}`, {
          method: 'DELETE',
        });
      }

      // Add new categories
      const toAddCats = categoryIds.filter((id) => !existingCatIds.includes(id));
      if (toAddCats.length > 0) {
        await apiFetch(`/contacts/${contactId}/categories`, {
          method: 'POST',
          body: JSON.stringify({ categoryIds: toAddCats }),
        });
      }

      // Replace tags: remove old, add new
      const existingTagNames = existing.data.tags.map((ct) => ct.tag.name);

      const toRemoveTags = existing.data.tags.filter((ct) => !tagNames.includes(ct.tag.name));
      for (const ct of toRemoveTags) {
        await apiFetch(`/contacts/${contactId}/tags/${ct.tagId}`, {
          method: 'DELETE',
        });
      }

      const toAddTags = tagNames.filter((name) => !existingTagNames.includes(name));
      if (toAddTags.length > 0) {
        await apiFetch(`/contacts/${contactId}/tags`, {
          method: 'POST',
          body: JSON.stringify({ tags: toAddTags }),
        });
      }

      return res;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['contact', vars.contactId] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}
