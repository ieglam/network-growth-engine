'use client';

import React, { useState, useMemo } from 'react';
import { useConflicts, useResolveConflict } from '../../hooks/useConflicts';
import type { DataConflict } from '../../hooks/useConflicts';

const SOURCE_LABELS: Record<string, string> = {
  manualValue: 'Manual',
  linkedinValue: 'LinkedIn',
  emailCalendarValue: 'Email / Calendar',
};

const SOURCE_PRIORITY: (keyof Pick<
  DataConflict,
  'manualValue' | 'emailCalendarValue' | 'linkedinValue'
>)[] = ['manualValue', 'emailCalendarValue', 'linkedinValue'];

export default function ConflictsPage() {
  const [showResolved, setShowResolved] = useState(false);
  const { data: conflictsData, isLoading, error } = useConflicts(showResolved);
  const resolveMutation = useResolveConflict();

  const conflicts = useMemo(() => conflictsData?.data ?? [], [conflictsData?.data]);

  function handleResolve(conflictId: string, value: string) {
    resolveMutation.mutate({ conflictId, resolvedValue: value });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Data Conflicts</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Resolve conflicting data from different sources
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 p-1 rounded-lg w-fit">
        <button
          onClick={() => setShowResolved(false)}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            !showResolved
              ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          Unresolved
        </button>
        <button
          onClick={() => setShowResolved(true)}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            showResolved
              ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          Resolved
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
          Failed to load conflicts
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
      )}

      {/* Empty state */}
      {!isLoading && !error && conflicts.length === 0 && (
        <div className="text-center py-12">
          <svg
            className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="mt-2 text-gray-500 dark:text-gray-400">
            {showResolved ? 'No resolved conflicts.' : 'No data conflicts to resolve.'}
          </p>
        </div>
      )}

      {/* Conflicts list */}
      <div className="space-y-3">
        {conflicts.map((conflict) => (
          <ConflictCard
            key={conflict.id}
            conflict={conflict}
            onResolve={handleResolve}
            isResolving={resolveMutation.isPending}
          />
        ))}
      </div>
    </div>
  );
}

function ConflictCard({
  conflict,
  onResolve,
  isResolving,
}: {
  conflict: DataConflict;
  onResolve: (_conflictId: string, _value: string) => void;
  isResolving: boolean;
}) {
  const sources = SOURCE_PRIORITY.filter((key) => conflict[key] != null).map((key) => ({
    key,
    label: SOURCE_LABELS[key],
    value: conflict[key]!,
  }));

  return (
    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-4">
      {/* Contact info + field name */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900 dark:text-white">
            {conflict.contact.firstName} {conflict.contact.lastName}
          </span>
          {conflict.contact.company && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              at {conflict.contact.company}
            </span>
          )}
        </div>
        <span className="px-2 py-0.5 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 rounded text-xs font-medium">
          {conflict.fieldName}
        </span>
      </div>

      {/* Source values */}
      {conflict.resolved ? (
        <div className="text-sm">
          <span className="text-gray-500 dark:text-gray-400">Resolved to: </span>
          <span className="font-medium text-gray-900 dark:text-white">
            {conflict.resolvedValue}
          </span>
          {conflict.resolvedAt && (
            <span className="text-gray-400 dark:text-gray-500 ml-2">
              on {new Date(conflict.resolvedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {sources.map(({ key, label, value }) => (
            <div
              key={key}
              className="flex items-center justify-between p-2 bg-gray-50 dark:bg-slate-800 rounded"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-24 shrink-0">
                  {label}
                </span>
                <span className="text-sm text-gray-900 dark:text-white truncate">{value}</span>
              </div>
              <button
                onClick={() => onResolve(conflict.id, value)}
                disabled={isResolving}
                className="px-3 py-1 text-xs font-medium text-primary-600 dark:text-primary-400 border border-primary-300 dark:border-primary-600 rounded hover:bg-primary-50 dark:hover:bg-primary-900/20 disabled:opacity-50 shrink-0"
              >
                Use This
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
