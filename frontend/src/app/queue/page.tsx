'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  useQueueToday,
  useQueueSummary,
  useMarkDone,
  useSkipItem,
  useSnoozeItem,
  useBatchApprove,
} from '@/hooks/useQueue';
import { useRegenerateQueue } from '@/hooks/useLinkedInSearch';
import type { QueueItem } from '@/lib/types';
import { LINKEDIN_NOTE_MAX_LENGTH, LINKEDIN_NOTE_WARNING_LENGTH } from '@nge/shared';

const ACTION_LABELS: Record<string, string> = {
  connection_request: 'Connection Requests',
  follow_up: 'Follow-ups',
  re_engagement: 'Re-engagements',
};

const ACTION_ICONS: Record<string, string> = {
  connection_request: 'CR',
  follow_up: 'FU',
  re_engagement: 'RE',
};

const ACTION_COLORS: Record<string, string> = {
  connection_request: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  follow_up: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  re_engagement: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
};

function addDays(date: Date, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export default function QueuePage() {
  const router = useRouter();
  const { data: queueData, isLoading } = useQueueToday();
  const { data: summaryData } = useQueueSummary();
  const markDone = useMarkDone();
  const skipItem = useSkipItem();
  const snoozeItem = useSnoozeItem();
  const batchApprove = useBatchApprove();
  const regenerateQueue = useRegenerateQueue();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [doneNotes, setDoneNotes] = useState<Record<string, string>>({});
  const [editedNotes, setEditedNotes] = useState<Record<string, string>>({});
  const [showGuided, setShowGuided] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  const items = useMemo(() => queueData?.data ?? [], [queueData?.data]);
  const summary = summaryData?.data;

  // Sort items: pending/approved first, then executed/skipped/snoozed
  const STATUS_ORDER: Record<string, number> = {
    pending: 0,
    approved: 1,
    executed: 2,
    skipped: 3,
    snoozed: 4,
  };

  // Group items by action type, sorting within each group by status
  const grouped = useMemo(() => {
    const groups: Record<string, QueueItem[]> = {};
    for (const item of items) {
      if (!groups[item.actionType]) groups[item.actionType] = [];
      groups[item.actionType].push(item);
    }
    // Sort each group: active items first, completed last
    for (const key of Object.keys(groups)) {
      groups[key].sort(
        (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
      );
    }
    return groups;
  }, [items]);

  // Count by action type (only pending/approved)
  const actionCounts = useMemo(() => {
    const counts: Record<string, number> = {
      connection_request: 0,
      follow_up: 0,
      re_engagement: 0,
    };
    for (const item of items) {
      if (item.status === 'pending' || item.status === 'approved') {
        counts[item.actionType] = (counts[item.actionType] || 0) + 1;
      }
    }
    return counts;
  }, [items]);

  const pendingIds = useMemo(
    () => items.filter((i) => i.status === 'pending').map((i) => i.id),
    [items]
  );

  const handleDone = (item: QueueItem) => {
    markDone.mutate({ id: item.id, notes: doneNotes[item.id] });
    setExpandedId(null);
  };

  const handleSkip = (item: QueueItem) => {
    skipItem.mutate({ id: item.id });
  };

  const handleSnooze = (item: QueueItem, days: number) => {
    snoozeItem.mutate({ id: item.id, snoozeUntil: addDays(new Date(), days) });
  };

  const toggleChecked = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAllPending = () => {
    if (checkedIds.size === pendingIds.length && pendingIds.every((id) => checkedIds.has(id))) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(pendingIds));
    }
  };

  const checkedPendingIds = pendingIds.filter((id) => checkedIds.has(id));

  const handleApproveAll = () => {
    if (pendingIds.length > 0) {
      batchApprove.mutate({ ids: pendingIds });
      setCheckedIds(new Set());
    }
  };

  const handleApproveSelected = () => {
    if (checkedPendingIds.length > 0) {
      batchApprove.mutate({ ids: checkedPendingIds });
      setCheckedIds(new Set());
    }
  };

  const getNoteText = (item: QueueItem): string => {
    if (editedNotes[item.id] !== undefined) return editedNotes[item.id];
    return item.personalizedMessage || '';
  };

  const copyToClipboard = async (text: string, itemId: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(itemId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Rate limit: count executed this week (Mon-Sun)
  const weeklyExecuted = summary ? summary.executed : 0;

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Daily Queue</h1>
        <button
          onClick={() => regenerateQueue.mutate()}
          disabled={regenerateQueue.isPending}
          className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50"
        >
          {regenerateQueue.isPending ? 'Regenerating...' : 'Regenerate Queue'}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Connection Requests"
          value={actionCounts.connection_request}
          color="blue"
        />
        <SummaryCard label="Follow-ups" value={actionCounts.follow_up} color="green" />
        <SummaryCard label="Re-engagements" value={actionCounts.re_engagement} color="orange" />
        <SummaryCard
          label="Rate Limit"
          value={`${weeklyExecuted}/100`}
          color="gray"
          subtitle="this week"
        />
      </div>

      {/* Queue status bar */}
      {summary && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-500 dark:text-gray-400">{summary.pending} pending</span>
              <span className="text-blue-600 dark:text-blue-400">{summary.approved} approved</span>
              <span className="text-green-600 dark:text-green-400">{summary.executed} done</span>
              <span className="text-gray-400 dark:text-gray-500">{summary.skipped} skipped</span>
              <span className="text-yellow-600 dark:text-yellow-400">
                {summary.snoozed} snoozed
              </span>
            </div>
            <div className="flex items-center gap-2">
              {checkedPendingIds.length > 0 && (
                <button
                  onClick={handleApproveSelected}
                  disabled={batchApprove.isPending}
                  className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  Approve Selected ({checkedPendingIds.length})
                </button>
              )}
              {pendingIds.length > 0 && (
                <button
                  onClick={handleApproveAll}
                  disabled={batchApprove.isPending}
                  className="px-3 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50"
                >
                  Approve All ({pendingIds.length})
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-12 text-center">
          <svg
            className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
            />
          </svg>
          <p className="text-gray-500 dark:text-gray-400">No queue items for today.</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
            Queue is generated daily based on your settings.
          </p>
        </div>
      )}

      {/* Grouped queue items */}
      {Object.entries(grouped).map(([actionType, groupItems]) => (
        <div key={actionType} className="space-y-3">
          <div className="flex items-center gap-2">
            {groupItems.some((i) => i.status === 'pending') && (
              <input
                type="checkbox"
                checked={
                  groupItems
                    .filter((i) => i.status === 'pending')
                    .every((i) => checkedIds.has(i.id)) &&
                  groupItems.some((i) => i.status === 'pending')
                }
                onChange={toggleAllPending}
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
            )}
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {ACTION_LABELS[actionType] || actionType} ({groupItems.length})
            </h2>
          </div>

          {groupItems.map((item) => {
            const noteText = getNoteText(item);
            const noteLength = noteText.length;
            const isOverLimit = noteLength > LINKEDIN_NOTE_MAX_LENGTH;
            const isNearLimit = noteLength > LINKEDIN_NOTE_WARNING_LENGTH;
            const isExpanded = expandedId === item.id;
            const isDone = item.status === 'executed';
            const isSkipped = item.status === 'skipped';
            const isSnoozed = item.status === 'snoozed';
            const isInactive = isDone || isSkipped || isSnoozed;

            return (
              <div
                key={item.id}
                className={`bg-white dark:bg-slate-900 rounded-lg border ${
                  isInactive
                    ? 'border-gray-100 dark:border-slate-800 opacity-60'
                    : isOverLimit
                      ? 'border-red-200 dark:border-red-800'
                      : 'border-gray-200 dark:border-slate-700'
                } overflow-hidden`}
              >
                {/* Item header */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                >
                  {/* Checkbox for pending items */}
                  {item.status === 'pending' && (
                    <input
                      type="checkbox"
                      checked={checkedIds.has(item.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleChecked(item.id);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 shrink-0"
                    />
                  )}

                  {/* Action type badge */}
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      ACTION_COLORS[item.actionType] || 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {ACTION_ICONS[item.actionType] || '?'}
                  </div>

                  {/* Contact info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="font-medium text-gray-900 dark:text-white cursor-pointer hover:text-primary-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/contacts/${item.contact.id}?from=queue`);
                        }}
                      >
                        {item.contact.firstName} {item.contact.lastName}
                      </span>
                      {item.contact.company && (
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          at {item.contact.company}
                        </span>
                      )}
                      {isDone && (
                        <span className="px-1.5 py-0.5 text-xs rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                          Done
                        </span>
                      )}
                      {isSkipped && (
                        <span className="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-400">
                          Skipped
                        </span>
                      )}
                      {isSnoozed && (
                        <span className="px-1.5 py-0.5 text-xs rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">
                          Snoozed
                        </span>
                      )}
                    </div>
                    {noteText && !isExpanded && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">
                        {noteText.slice(0, 80)}
                        {noteText.length > 80 ? '...' : ''}
                      </p>
                    )}
                  </div>

                  {/* Note character count */}
                  {noteText && item.actionType === 'connection_request' && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isOverLimit && (
                        <svg
                          className="w-4 h-4 text-red-500"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                      <span
                        className={`text-xs font-mono ${
                          isOverLimit
                            ? 'text-red-600 dark:text-red-400'
                            : isNearLimit
                              ? 'text-yellow-600 dark:text-yellow-400'
                              : 'text-gray-400 dark:text-gray-500'
                        }`}
                      >
                        {noteLength}/{LINKEDIN_NOTE_MAX_LENGTH}
                      </span>
                    </div>
                  )}

                  {/* Expand chevron */}
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${
                      isExpanded ? 'rotate-90' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-slate-800 px-4 py-4 space-y-4">
                    {/* Connection note editor */}
                    {noteText !== undefined && item.actionType === 'connection_request' && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            Connection Note
                          </label>
                          <span
                            className={`text-xs font-mono ${
                              isOverLimit
                                ? 'text-red-600 dark:text-red-400 font-bold'
                                : isNearLimit
                                  ? 'text-yellow-600 dark:text-yellow-400'
                                  : 'text-gray-400'
                            }`}
                          >
                            {noteLength}/{LINKEDIN_NOTE_MAX_LENGTH}
                          </span>
                        </div>
                        <textarea
                          value={noteText}
                          onChange={(e) =>
                            setEditedNotes((prev) => ({
                              ...prev,
                              [item.id]: e.target.value,
                            }))
                          }
                          rows={4}
                          disabled={isInactive}
                          className={`w-full rounded-lg border ${
                            isOverLimit
                              ? 'border-red-300 dark:border-red-600'
                              : 'border-gray-300 dark:border-slate-600'
                          } bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50`}
                        />
                        {isOverLimit && (
                          <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                            Note exceeds 300 character LinkedIn limit by{' '}
                            {noteLength - LINKEDIN_NOTE_MAX_LENGTH} characters.
                          </p>
                        )}
                      </div>
                    )}

                    {/* Guided mode instructions */}
                    {item.contact.linkedinUrl && !isInactive && (
                      <div>
                        <button
                          onClick={() =>
                            setShowGuided((prev) => ({
                              ...prev,
                              [item.id]: !prev[item.id],
                            }))
                          }
                          className="text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400 font-medium"
                        >
                          {showGuided[item.id] ? 'Hide Instructions' : 'Show Instructions'}
                        </button>
                        {showGuided[item.id] && (
                          <div className="mt-2 bg-gray-50 dark:bg-slate-800 rounded-lg p-3 space-y-2 text-sm">
                            <p className="text-gray-700 dark:text-gray-300">
                              1. Go to{' '}
                              <a
                                href={item.contact.linkedinUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary-600 underline"
                              >
                                {item.contact.firstName}&apos;s LinkedIn profile
                              </a>
                            </p>
                            <p className="text-gray-700 dark:text-gray-300">
                              2. Click <strong>Connect</strong>
                            </p>
                            {noteText && (
                              <>
                                <p className="text-gray-700 dark:text-gray-300">
                                  3. Click <strong>Add a note</strong>
                                </p>
                                <p className="text-gray-700 dark:text-gray-300">
                                  4. Paste the following note:
                                </p>
                                <div className="relative">
                                  <pre className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded p-2 text-xs whitespace-pre-wrap">
                                    {noteText}
                                  </pre>
                                  <button
                                    onClick={() => copyToClipboard(noteText, item.id)}
                                    className="absolute top-1 right-1 px-2 py-1 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 text-xs rounded hover:bg-gray-200 dark:hover:bg-slate-600"
                                  >
                                    {copiedId === item.id ? 'Copied!' : 'Copy'}
                                  </button>
                                </div>
                              </>
                            )}
                            <p className="text-gray-700 dark:text-gray-300">
                              {noteText ? '5' : '3'}. Click <strong>Send</strong>
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Done notes */}
                    {!isInactive && (
                      <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
                          Notes (optional)
                        </label>
                        <input
                          type="text"
                          value={doneNotes[item.id] || ''}
                          onChange={(e) =>
                            setDoneNotes((prev) => ({
                              ...prev,
                              [item.id]: e.target.value,
                            }))
                          }
                          placeholder="Add a note when marking as done..."
                          className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </div>
                    )}

                    {/* Action buttons */}
                    {!isInactive && (
                      <div className="flex items-center gap-2 pt-2">
                        <button
                          onClick={() => handleDone(item)}
                          disabled={markDone.isPending}
                          className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
                        >
                          Done
                        </button>
                        <button
                          onClick={() => handleSkip(item)}
                          disabled={skipItem.isPending}
                          className="px-3 py-1.5 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
                        >
                          Skip
                        </button>
                        <div className="relative group">
                          <button className="px-3 py-1.5 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800">
                            Snooze
                          </button>
                          <div className="absolute top-full mt-1 left-0 hidden group-hover:block bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg z-10 py-1">
                            <button
                              onClick={() => handleSnooze(item, 3)}
                              className="block w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                            >
                              3 days
                            </button>
                            <button
                              onClick={() => handleSnooze(item, 7)}
                              className="block w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                            >
                              1 week
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
  subtitle,
}: {
  label: string;
  value: number | string;
  color: 'blue' | 'green' | 'orange' | 'gray';
  subtitle?: string;
}) {
  const colorClasses = {
    blue: 'text-blue-600 dark:text-blue-400',
    green: 'text-green-600 dark:text-green-400',
    orange: 'text-orange-600 dark:text-orange-400',
    gray: 'text-gray-600 dark:text-gray-400',
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-4 text-center">
      <p className={`text-2xl font-bold ${colorClasses[color]}`}>{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
      {subtitle && <p className="text-xs text-gray-400 dark:text-gray-500">{subtitle}</p>}
    </div>
  );
}
