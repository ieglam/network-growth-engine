'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { type RowSelectionState, type SortingState } from '@tanstack/react-table';
import {
  useContacts,
  useCategories,
  useTags,
  useSources,
  useBulkAddTag,
  useBulkRemoveTag,
  useBulkCategorize,
  useBulkDelete,
  useAutoCategorize,
} from '@/hooks/useContacts';
import type { AutoCategorizeResult } from '@/hooks/useContacts';
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
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [scoreMin, setScoreMin] = useState('');
  const [scoreMax, setScoreMax] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [page, setPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [bulkAction, setBulkAction] = useState('');
  const [bulkTagId, setBulkTagId] = useState('');
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [autoCategorizeResults, setAutoCategorizeResults] = useState<AutoCategorizeResult[] | null>(
    null
  );
  const [showAutoCategorizeDetails, setShowAutoCategorizeDetails] = useState(false);
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
      source: sourceFilter || undefined,
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
      sourceFilter,
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
  const { data: sourcesData } = useSources();
  const bulkAddTag = useBulkAddTag();
  const bulkRemoveTag = useBulkRemoveTag();
  const bulkCategorize = useBulkCategorize();
  const bulkDelete = useBulkDelete();
  const autoCategorize = useAutoCategorize();

  const contacts = data?.data ?? [];
  const pagination = data?.pagination;
  const categories = catData?.data ?? [];
  const tags = tagData?.data ?? [];
  const sources = sourcesData?.data ?? [];
  const selectedIds = Object.keys(rowSelection);
  const totalPages = pagination ? Math.ceil(pagination.total / limit) : 0;

  const handleClearFilters = () => {
    setStatusFilter([]);
    setCategoryFilter('');
    setTagFilter('');
    setSourceFilter('');
    setScoreMin('');
    setScoreMax('');
    setLocationFilter('');
    setPage(0);
  };

  const handleBulkAction = async () => {
    if (!bulkAction || selectedIds.length === 0) return;

    if (bulkAction === 'delete') {
      if (!confirmDelete) {
        setConfirmDelete(true);
        return;
      }
      bulkDelete.mutate({ contactIds: selectedIds });
      setConfirmDelete(false);
    } else if (bulkAction === 'assign_category') {
      if (!bulkCategoryId) return;
      bulkCategorize.mutate({ contactIds: selectedIds, categoryId: bulkCategoryId });
      setBulkCategoryId('');
    } else if (bulkAction === 'add_tag') {
      if (!bulkTagId) return;
      bulkAddTag.mutate({ contactIds: selectedIds, tagId: bulkTagId });
    } else if (bulkAction === 'remove_tag') {
      if (!bulkTagId) return;
      bulkRemoveTag.mutate({ contactIds: selectedIds, tagId: bulkTagId });
    }

    setBulkAction('');
    setBulkTagId('');
    setRowSelection({});
  };

  const handleAutoCategorize = () => {
    autoCategorize.mutate(
      {
        contactIds: selectedIds.length > 0 ? selectedIds : undefined,
      },
      {
        onSuccess: (res) => {
          setAutoCategorizeResults(res.data.results);
          setShowAutoCategorizeDetails(false);
          setRowSelection({});
        },
      }
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Contacts</h1>
        <div className="flex items-center gap-3">
          {pagination && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {pagination.total} total
            </span>
          )}
          <button
            onClick={handleAutoCategorize}
            disabled={autoCategorize.isPending}
            className="px-3 py-1.5 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 flex items-center gap-1.5 disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
            {autoCategorize.isPending ? 'Categorizing...' : 'Auto-Categorize'}
          </button>
          <button
            onClick={() => router.push('/contacts/import')}
            className="px-3 py-1.5 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            Import CSV
          </button>
          <button
            onClick={() => router.push('/contacts/new')}
            className="px-3 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Add Contact
          </button>
        </div>
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
          sourceFilter={sourceFilter}
          onSourceChange={(s) => {
            setSourceFilter(s);
            setPage(0);
          }}
          sources={sources}
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
            onChange={(e) => {
              setBulkAction(e.target.value);
              setBulkTagId('');
              setBulkCategoryId('');
              setConfirmDelete(false);
            }}
            className="rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm px-2 py-1 text-gray-700 dark:text-gray-300"
          >
            <option value="">Choose action...</option>
            <option value="assign_category">Assign category</option>
            <option value="add_tag">Add tag</option>
            <option value="remove_tag">Remove tag</option>
            <option value="delete">Delete contacts</option>
          </select>
          {bulkAction === 'assign_category' && (
            <select
              value={bulkCategoryId}
              onChange={(e) => setBulkCategoryId(e.target.value)}
              className="rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm px-2 py-1 text-gray-700 dark:text-gray-300"
            >
              <option value="">Select category...</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {(bulkAction === 'add_tag' || bulkAction === 'remove_tag') && (
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
          {bulkAction === 'delete' && (
            <>
              {confirmDelete ? (
                <span className="text-sm text-red-600 dark:text-red-400 font-medium">
                  Delete {selectedIds.length} contacts?
                </span>
              ) : null}
              <button
                onClick={handleBulkAction}
                className={`px-3 py-1 text-white text-sm rounded-md ${
                  confirmDelete ? 'bg-red-600 hover:bg-red-700' : 'bg-red-500 hover:bg-red-600'
                }`}
              >
                {confirmDelete ? 'Confirm Delete' : 'Delete'}
              </button>
            </>
          )}
          {((bulkAction === 'assign_category' && bulkCategoryId) ||
            ((bulkAction === 'add_tag' || bulkAction === 'remove_tag') && bulkTagId)) && (
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

      {/* Auto-categorize result banner */}
      {autoCategorizeResults && (
        <div className="rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-green-800 dark:text-green-300">
              {autoCategorizeResults.length} contact
              {autoCategorizeResults.length !== 1 ? 's' : ''} categorized
            </span>
            <div className="flex items-center gap-2">
              {autoCategorizeResults.length > 0 && (
                <button
                  onClick={() => setShowAutoCategorizeDetails(!showAutoCategorizeDetails)}
                  className="text-xs text-green-700 dark:text-green-400 hover:underline"
                >
                  {showAutoCategorizeDetails ? 'Hide details' : 'Show details'}
                </button>
              )}
              <button
                onClick={() => setAutoCategorizeResults(null)}
                className="text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
          {showAutoCategorizeDetails && autoCategorizeResults.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-green-700 dark:text-green-400">
              {autoCategorizeResults.map((r) => (
                <li key={r.contactId}>
                  {r.firstName} {r.lastName} &rarr; {r.category}
                </li>
              ))}
            </ul>
          )}
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
