'use client';

import React from 'react';
import type { ContactStatus } from '@nge/shared';
import type { Category, Tag } from '@/lib/types';

const STATUSES: { value: ContactStatus; label: string }[] = [
  { value: 'target', label: 'Target' },
  { value: 'requested', label: 'Requested' },
  { value: 'connected', label: 'Connected' },
  { value: 'engaged', label: 'Engaged' },
  { value: 'relationship', label: 'Relationship' },
];

interface ContactFiltersProps {
  statusFilter: string[];
  onStatusChange: (_statuses: string[]) => void;
  categoryFilter: string;
  onCategoryChange: (_cat: string) => void;
  tagFilter: string;
  onTagChange: (_tag: string) => void;
  scoreMin: string;
  scoreMax: string;
  onScoreMinChange: (_val: string) => void;
  onScoreMaxChange: (_val: string) => void;
  locationFilter: string;
  onLocationChange: (_loc: string) => void;
  categories: Category[];
  tags: Tag[];
  onClear: () => void;
}

export default function ContactFilters({
  statusFilter,
  onStatusChange,
  categoryFilter,
  onCategoryChange,
  tagFilter,
  onTagChange,
  scoreMin,
  scoreMax,
  onScoreMinChange,
  onScoreMaxChange,
  locationFilter,
  onLocationChange,
  categories,
  tags,
  onClear,
}: ContactFiltersProps) {
  const hasFilters =
    statusFilter.length > 0 ||
    categoryFilter ||
    tagFilter ||
    scoreMin ||
    scoreMax ||
    locationFilter;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Filters</h3>
        {hasFilters && (
          <button
            onClick={onClear}
            className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Status filter */}
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
          Status
        </label>
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => {
                if (statusFilter.includes(s.value)) {
                  onStatusChange(statusFilter.filter((v) => v !== s.value));
                } else {
                  onStatusChange([...statusFilter, s.value]);
                }
              }}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                statusFilter.includes(s.value)
                  ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-gray-400 dark:hover:bg-slate-700'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Category filter */}
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
          Category
        </label>
        <select
          value={categoryFilter}
          onChange={(e) => onCategoryChange(e.target.value)}
          className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm px-3 py-1.5 text-gray-700 dark:text-gray-300"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Tag filter */}
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
          Tag
        </label>
        <select
          value={tagFilter}
          onChange={(e) => onTagChange(e.target.value)}
          className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm px-3 py-1.5 text-gray-700 dark:text-gray-300"
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {/* Score range */}
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
          Score Range
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            placeholder="Min"
            min={0}
            max={100}
            value={scoreMin}
            onChange={(e) => onScoreMinChange(e.target.value)}
            className="w-20 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm px-2 py-1.5 text-gray-700 dark:text-gray-300"
          />
          <span className="text-gray-400">-</span>
          <input
            type="number"
            placeholder="Max"
            min={0}
            max={100}
            value={scoreMax}
            onChange={(e) => onScoreMaxChange(e.target.value)}
            className="w-20 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm px-2 py-1.5 text-gray-700 dark:text-gray-300"
          />
        </div>
      </div>

      {/* Location */}
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
          Location
        </label>
        <input
          type="text"
          placeholder="Filter by location..."
          value={locationFilter}
          onChange={(e) => onLocationChange(e.target.value)}
          className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm px-3 py-1.5 text-gray-700 dark:text-gray-300"
        />
      </div>
    </div>
  );
}
