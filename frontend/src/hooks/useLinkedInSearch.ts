import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface SearchCriteria {
  jobTitles?: string[];
  companies?: string[];
  industries?: string[];
  keywords?: string;
  location?: string;
  maxResults?: number;
}

export interface ScrapedProspect {
  firstName: string;
  lastName: string;
  fullName: string;
  title: string | null;
  company: string | null;
  linkedinUrl: string;
  headline: string | null;
  location: string | null;
  mutualConnectionsCount: number;
}

export interface SearchProgress {
  status: 'initializing' | 'searching' | 'scraping' | 'complete' | 'error';
  currentPage: number;
  totalFound: number;
  scraped: number;
  message: string;
}

export interface ImportResult {
  imported: number;
  duplicatesSkipped: number;
  errors: number;
  details: {
    importedContacts: { id: string; name: string; linkedinUrl: string }[];
    skippedDuplicates: { name: string; linkedinUrl: string; existingId: string }[];
    errorMessages: string[];
  };
}

export interface SearchHistoryEntry {
  id: string;
  criteria: SearchCriteria;
  resultCount: number;
  importedCount: number;
  searchedAt: string;
}

export function useSearchProgress(enabled: boolean) {
  return useQuery<{
    success: boolean;
    data: { progress: SearchProgress | null; results: ScrapedProspect[]; resultCount: number };
  }>({
    queryKey: ['linkedin-search-progress'],
    queryFn: () => apiFetch('/linkedin/search/progress'),
    refetchInterval: enabled ? 2000 : false,
  });
}

export function useSearchResults() {
  return useQuery<{
    success: boolean;
    data: { results: ScrapedProspect[]; count: number };
  }>({
    queryKey: ['linkedin-search-results'],
    queryFn: () => apiFetch('/linkedin/search/results'),
  });
}

export function useSearchHistory() {
  return useQuery<{ success: boolean; data: SearchHistoryEntry[] }>({
    queryKey: ['linkedin-search-history'],
    queryFn: () => apiFetch('/linkedin/search/history'),
  });
}

export function useStartSearch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (criteria: SearchCriteria) => {
      return apiFetch('/linkedin/search', {
        method: 'POST',
        body: JSON.stringify(criteria),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-search-progress'] });
    },
  });
}

export function useImportProspects() {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean; data: ImportResult }, Error, ScrapedProspect[]>({
    mutationFn: async (prospects: ScrapedProspect[]) => {
      return apiFetch('/linkedin/search/import', {
        method: 'POST',
        body: JSON.stringify({ prospects }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-search-history'] });
      queryClient.invalidateQueries({ queryKey: ['linkedin-search-results'] });
      queryClient.invalidateQueries({ queryKey: ['linkedin-search-progress'] });
    },
  });
}

export function useRegenerateQueue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      return apiFetch('/queue/regenerate', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue-today'] });
      queryClient.invalidateQueries({ queryKey: ['queue-summary'] });
    },
  });
}
