import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

interface ConflictContact {
  id: string;
  firstName: string;
  lastName: string;
  company: string | null;
}

export interface DataConflict {
  id: string;
  contactId: string;
  fieldName: string;
  manualValue: string | null;
  linkedinValue: string | null;
  emailCalendarValue: string | null;
  resolved: boolean;
  resolvedValue: string | null;
  resolvedAt: string | null;
  createdAt: string;
  contact: ConflictContact;
}

async function fetchConflicts(
  resolved: boolean = false
): Promise<{ success: boolean; data: DataConflict[] }> {
  const res = await fetch(`${API_BASE}/conflicts?resolved=${resolved}`);
  if (!res.ok) throw new Error('Failed to fetch conflicts');
  return res.json();
}

async function fetchConflictCount(): Promise<{ success: boolean; data: { count: number } }> {
  const res = await fetch(`${API_BASE}/conflicts/count`);
  if (!res.ok) throw new Error('Failed to fetch conflict count');
  return res.json();
}

async function resolveConflict(
  conflictId: string,
  resolvedValue: string
): Promise<{ success: boolean; data: { message: string } }> {
  const res = await fetch(`${API_BASE}/conflicts/${conflictId}/resolve`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolvedValue }),
  });
  if (!res.ok) throw new Error('Failed to resolve conflict');
  return res.json();
}

export function useConflicts(resolved: boolean = false) {
  return useQuery({
    queryKey: ['conflicts', resolved],
    queryFn: () => fetchConflicts(resolved),
  });
}

export function useConflictCount() {
  return useQuery({
    queryKey: ['conflicts-count'],
    queryFn: fetchConflictCount,
  });
}

export function useResolveConflict() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conflictId, resolvedValue }: { conflictId: string; resolvedValue: string }) =>
      resolveConflict(conflictId, resolvedValue),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conflicts'] });
      queryClient.invalidateQueries({ queryKey: ['conflicts-count'] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}
