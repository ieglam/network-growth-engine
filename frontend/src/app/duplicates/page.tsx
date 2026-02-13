'use client';

import React, { useState, useMemo } from 'react';
import {
  useDuplicates,
  useScanDuplicates,
  useMergeDuplicate,
  useDismissDuplicate,
} from '../../hooks/useDuplicates';
import type { DuplicatePair, DuplicateContact } from '../../lib/types';

const MATCH_TYPE_LABELS: Record<string, string> = {
  linkedin_url: 'LinkedIn URL',
  email: 'Email',
  phone: 'Phone',
  name_company: 'Name + Company',
  fuzzy_name_company: 'Fuzzy Name + Company',
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
};

const COMPARE_FIELDS: { key: keyof DuplicateContact; label: string }[] = [
  { key: 'firstName', label: 'First Name' },
  { key: 'lastName', label: 'Last Name' },
  { key: 'title', label: 'Title' },
  { key: 'company', label: 'Company' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'linkedinUrl', label: 'LinkedIn' },
  { key: 'location', label: 'Location' },
  { key: 'headline', label: 'Headline' },
  { key: 'status', label: 'Status' },
  { key: 'relationshipScore', label: 'Score' },
];

export default function DuplicatesPage() {
  const [statusFilter, setStatusFilter] = useState('pending');
  const { data: duplicatesData, isLoading, error } = useDuplicates(statusFilter);
  const scanMutation = useScanDuplicates();
  const mergeMutation = useMergeDuplicate();
  const dismissMutation = useDismissDuplicate();
  const [expandedPairId, setExpandedPairId] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<{ autoMerged: number; flagged: number } | null>(
    null
  );

  const pairs = useMemo(() => duplicatesData?.data ?? [], [duplicatesData?.data]);

  function handleScan() {
    setScanResult(null);
    scanMutation.mutate(undefined, {
      onSuccess: (res) => {
        setScanResult(res.data);
      },
    });
  }

  function handleMerge(pairId: string, primaryContactId: string) {
    mergeMutation.mutate({ pairId, primaryContactId });
  }

  function handleDismiss(pairId: string) {
    dismissMutation.mutate(pairId);
  }

  function fieldsDiffer(a: DuplicateContact, b: DuplicateContact, key: keyof DuplicateContact) {
    const valA = a[key];
    const valB = b[key];
    if (valA == null && valB == null) return false;
    if (valA == null || valB == null) return true;
    return String(valA).toLowerCase() !== String(valB).toLowerCase();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Duplicate Review</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Review and resolve potential duplicate contacts
          </p>
        </div>
        <button
          onClick={handleScan}
          disabled={scanMutation.isPending}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm font-medium"
        >
          {scanMutation.isPending ? 'Scanning...' : 'Run Scan'}
        </button>
      </div>

      {/* Scan result banner */}
      {scanResult && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-300">
          Scan complete: {scanResult.autoMerged} auto-merged, {scanResult.flagged} flagged for
          review
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 p-1 rounded-lg w-fit">
        {['pending', 'merged', 'dismissed'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              statusFilter === s
                ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
          Failed to load duplicates
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
      )}

      {/* Empty state */}
      {!isLoading && !error && pairs.length === 0 && (
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
            {statusFilter === 'pending'
              ? 'No pending duplicates. Run a scan to check for new ones.'
              : `No ${statusFilter} pairs.`}
          </p>
        </div>
      )}

      {/* Duplicate pairs list */}
      <div className="space-y-3">
        {pairs.map((pair) => (
          <DuplicatePairCard
            key={pair.id}
            pair={pair}
            isExpanded={expandedPairId === pair.id}
            onToggle={() => setExpandedPairId(expandedPairId === pair.id ? null : pair.id)}
            onMerge={handleMerge}
            onDismiss={handleDismiss}
            isMerging={mergeMutation.isPending}
            isDismissing={dismissMutation.isPending}
            fieldsDiffer={fieldsDiffer}
          />
        ))}
      </div>
    </div>
  );
}

function DuplicatePairCard({
  pair,
  isExpanded,
  onToggle,
  onMerge,
  onDismiss,
  isMerging,
  isDismissing,
  fieldsDiffer,
}: {
  pair: DuplicatePair;
  isExpanded: boolean;
  onToggle: () => void;
  onMerge: (_pairId: string, _primaryId: string) => void;
  onDismiss: (_pairId: string) => void;
  isMerging: boolean;
  isDismissing: boolean;
  fieldsDiffer: (
    _a: DuplicateContact,
    _b: DuplicateContact,
    _key: keyof DuplicateContact
  ) => boolean;
}) {
  const { contactA, contactB } = pair;
  const isPending = pair.status === 'pending';

  return (
    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
      {/* Summary row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors text-left"
      >
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-gray-900 dark:text-white truncate">
              {contactA.firstName} {contactA.lastName}
            </span>
            <span className="text-gray-400">&amp;</span>
            <span className="font-medium text-gray-900 dark:text-white truncate">
              {contactB.firstName} {contactB.lastName}
            </span>
          </div>
          {contactA.company && (
            <span className="text-sm text-gray-500 dark:text-gray-400 truncate hidden sm:inline">
              {contactA.company}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium ${CONFIDENCE_COLORS[pair.confidence] || 'bg-gray-100 text-gray-600'}`}
          >
            {pair.confidence}
          </span>
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300">
            {MATCH_TYPE_LABELS[pair.matchType] || pair.matchType}
          </span>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded: Side-by-side comparison */}
      {isExpanded && (
        <div className="border-t border-gray-200 dark:border-slate-700">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-slate-800">
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-1/5">
                    Field
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-2/5">
                    Contact A
                    {isPending && (
                      <button
                        onClick={() => onMerge(pair.id, contactA.id)}
                        disabled={isMerging}
                        className="ml-2 px-2 py-0.5 bg-primary-600 text-white rounded text-xs hover:bg-primary-700 disabled:opacity-50 normal-case font-normal"
                      >
                        Keep This
                      </button>
                    )}
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-2/5">
                    Contact B
                    {isPending && (
                      <button
                        onClick={() => onMerge(pair.id, contactB.id)}
                        disabled={isMerging}
                        className="ml-2 px-2 py-0.5 bg-primary-600 text-white rounded text-xs hover:bg-primary-700 disabled:opacity-50 normal-case font-normal"
                      >
                        Keep This
                      </button>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARE_FIELDS.map(({ key, label }) => {
                  const differs = fieldsDiffer(contactA, contactB, key);
                  return (
                    <tr
                      key={key}
                      className={
                        differs
                          ? 'bg-yellow-50 dark:bg-yellow-900/10'
                          : 'even:bg-gray-50 dark:even:bg-slate-800/50'
                      }
                    >
                      <td className="px-4 py-2 text-gray-500 dark:text-gray-400 font-medium">
                        {label}
                      </td>
                      <td className="px-4 py-2 text-gray-900 dark:text-white break-all">
                        {formatFieldValue(contactA[key])}
                      </td>
                      <td className="px-4 py-2 text-gray-900 dark:text-white break-all">
                        {formatFieldValue(contactB[key])}
                      </td>
                    </tr>
                  );
                })}
                <tr className="even:bg-gray-50 dark:even:bg-slate-800/50">
                  <td className="px-4 py-2 text-gray-500 dark:text-gray-400 font-medium">
                    Created
                  </td>
                  <td className="px-4 py-2 text-gray-900 dark:text-white">
                    {new Date(contactA.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2 text-gray-900 dark:text-white">
                    {new Date(contactB.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Action bar */}
          {isPending && (
            <div className="flex items-center justify-end gap-2 px-4 py-3 bg-gray-50 dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700">
              <button
                onClick={() => onDismiss(pair.id)}
                disabled={isDismissing}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 disabled:opacity-50"
              >
                Not a Duplicate
              </button>
            </div>
          )}

          {/* Resolved status */}
          {!isPending && (
            <div className="px-4 py-3 bg-gray-50 dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 text-sm text-gray-500 dark:text-gray-400">
              {pair.status === 'merged' ? 'Merged' : 'Dismissed'}{' '}
              {pair.resolvedAt && `on ${new Date(pair.resolvedAt).toLocaleDateString()}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatFieldValue(value: string | number | null | undefined): string {
  if (value == null) return '\u2014';
  return String(value);
}
