'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { type RowSelectionState, type SortingState } from '@tanstack/react-table';
import {
  useContacts,
  useCategories,
  useTags,
  useBulkAddTag,
  useBulkRemoveTag,
} from '@/hooks/useContacts';
import type { ContactFilters as Filters } from '@/hooks/useContacts';
import ContactTable from '@/components/ContactTable';
import ContactFilters from '@/components/ContactFilters';

const SORT_MAP: Record<string, string> = {
  name: 'name',
  company: 'company',
  relationshipScore: 'relationship_score',
  lastInteractionAt: 'last_interaction',
};

export default function ContactsPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [scoreMin, setScoreMin] = useState('');
  const [scoreMax, setScoreMax] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [page, setPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [bulkAction, setBulkAction] = useState('');
  const [bulkTagId, setBulkTagId] = useState('');
  const limit = 50;

  // Debounce search
  const searchTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(0);
    }, 300);
  }, []);

  // Build sorting string for API
  const sortString = useMemo(() => {
    if (sorting.length === 0) return undefined;
    const s = sorting[0];
    const field = SORT_MAP[s.id] || s.id;
    return s.desc ? `-${field}` : field;
  }, [sorting]);

  const filters: Filters = useMemo(
    () => ({
      q: debouncedSearch || undefined,
      status: statusFilter.length > 0 ? statusFilter.join(',') : undefined,
      category: categoryFilter || undefined,
      tag: tagFilter || undefined,
      scoreMin: scoreMin ? Number(scoreMin) : undefined,
      scoreMax: scoreMax ? Number(scoreMax) : undefined,
      location: locationFilter || undefined,
      sort: sortString,
      limit,
      offset: page * limit,
    }),
    [
      debouncedSearch,
      statusFilter,
      categoryFilter,
      tagFilter,
      scoreMin,
      scoreMax,
      locationFilter,
      sortString,
      page,
    ]
  );

  const { data, isLoading, error } = useContacts(filters);
  const { data: catData } = useCategories();
  const { data: tagData } = useTags();
  const bulkAddTag = useBulkAddTag();
  const bulkRemoveTag = useBulkRemoveTag();

  const contacts = data?.data ?? [];
  const pagination = data?.pagination;
  const categories = catData?.data ?? [];
  const tags = tagData?.data ?? [];
  const selectedIds = Object.keys(rowSelection);
  const totalPages = pagination ? Math.ceil(pagination.total / limit) : 0;

  const handleClearFilters = () => {
    setStatusFilter([]);
    setCategoryFilter('');
    setTagFilter('');
    setScoreMin('');
    setScoreMax('');
    setLocationFilter('');
    setPage(0);
  };

  const handleBulkAction = async () => {
    if (!bulkAction || !bulkTagId || selectedIds.length === 0) return;
    if (bulkAction === 'add_tag') {
      bulkAddTag.mutate({ contactIds: selectedIds, tagId: bulkTagId });
    } else if (bulkAction === 'remove_tag') {
      bulkRemoveTag.mutate({ contactIds: selectedIds, tagId: bulkTagId });
    }
    setBulkAction('');
    setBulkTagId('');
    setRowSelection({});
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Contacts</h1>
        {pagination && (
          <span className="text-sm text-gray-500 dark:text-gray-400">{pagination.total} total</span>
        )}
      </div>

      {/* Search and filter toggle */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
            showFilters
              ? 'bg-primary-50 border-primary-300 text-primary-700 dark:bg-primary-900/30 dark:border-primary-700 dark:text-primary-300'
              : 'border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800'
          }`}
        >
          Filters
        </button>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <ContactFilters
          statusFilter={statusFilter}
          onStatusChange={(s) => {
            setStatusFilter(s);
            setPage(0);
          }}
          categoryFilter={categoryFilter}
          onCategoryChange={(c) => {
            setCategoryFilter(c);
            setPage(0);
          }}
          tagFilter={tagFilter}
          onTagChange={(t) => {
            setTagFilter(t);
            setPage(0);
          }}
          scoreMin={scoreMin}
          scoreMax={scoreMax}
          onScoreMinChange={(v) => {
            setScoreMin(v);
            setPage(0);
          }}
          onScoreMaxChange={(v) => {
            setScoreMax(v);
            setPage(0);
          }}
          locationFilter={locationFilter}
          onLocationChange={(l) => {
            setLocationFilter(l);
            setPage(0);
          }}
          categories={categories}
          tags={tags}
          onClear={handleClearFilters}
        />
      )}

      {/* Bulk actions */}
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-3 bg-primary-50 dark:bg-primary-900/20 rounded-lg px-4 py-2.5">
          <span className="text-sm font-medium text-primary-700 dark:text-primary-300">
            {selectedIds.length} selected
          </span>
          <select
            value={bulkAction}
            onChange={(e) => setBulkAction(e.target.value)}
            className="rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm px-2 py-1 text-gray-700 dark:text-gray-300"
          >
            <option value="">Choose action...</option>
            <option value="add_tag">Add tag</option>
            <option value="remove_tag">Remove tag</option>
          </select>
          {bulkAction && (
            <select
              value={bulkTagId}
              onChange={(e) => setBulkTagId(e.target.value)}
              className="rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm px-2 py-1 text-gray-700 dark:text-gray-300"
            >
              <option value="">Select tag...</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          {bulkAction && bulkTagId && (
            <button
              onClick={handleBulkAction}
              className="px-3 py-1 bg-primary-600 text-white text-sm rounded-md hover:bg-primary-700"
            >
              Apply
            </button>
          )}
          <button
            onClick={() => {
              setRowSelection({});
              setBulkAction('');
              setBulkTagId('');
            }}
            className="ml-auto text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
        {error ? (
          <div className="p-8 text-center text-red-600 dark:text-red-400">
            Failed to load contacts: {(error as Error).message}
          </div>
        ) : isLoading ? (
          <div className="p-8 flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : (
          <ContactTable
            contacts={contacts}
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
            sorting={sorting}
            onSortingChange={setSorting}
          />
        )}
      </div>

      {/* Pagination */}
      {pagination && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Showing {page * limit + 1}-{Math.min((page + 1) * limit, pagination.total)} of{' '}
            {pagination.total}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-slate-600 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-slate-600 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
