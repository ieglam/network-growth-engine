'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useContact, useContactInteractions, useUpdateContactStatus } from '@/hooks/useContacts';
import StatusBadge from '@/components/StatusBadge';
import ScoreBadge from '@/components/ScoreBadge';
import type { ContactStatus } from '@nge/shared';

const STATUS_OPTIONS: ContactStatus[] = [
  'target',
  'requested',
  'connected',
  'engaged',
  'relationship',
];

const INTERACTION_ICONS: Record<string, string> = {
  linkedin_message: 'LI',
  email: 'EM',
  meeting_1on1_inperson: 'M1',
  meeting_1on1_virtual: 'MV',
  meeting_group: 'MG',
  linkedin_comment_given: 'CG',
  linkedin_comment_received: 'CR',
  linkedin_like_given: 'LG',
  linkedin_like_received: 'LR',
  introduction_given: 'IG',
  introduction_received: 'IR',
  manual_note: 'MN',
  connection_request_sent: 'CS',
  connection_request_accepted: 'CA',
};

const INTERACTION_LABELS: Record<string, string> = {
  linkedin_message: 'LinkedIn Message',
  email: 'Email',
  meeting_1on1_inperson: 'In-person Meeting',
  meeting_1on1_virtual: 'Virtual Meeting',
  meeting_group: 'Group Meeting',
  linkedin_comment_given: 'Comment Given',
  linkedin_comment_received: 'Comment Received',
  linkedin_like_given: 'Like Given',
  linkedin_like_received: 'Like Received',
  introduction_given: 'Intro Given',
  introduction_received: 'Intro Received',
  manual_note: 'Note',
  connection_request_sent: 'Connection Sent',
  connection_request_accepted: 'Connection Accepted',
};

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ContactDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { data, isLoading, error } = useContact(id);
  const { data: interactionsData } = useContactInteractions(id);
  const updateStatus = useUpdateContactStatus();
  const [showStatusChange, setShowStatusChange] = useState(false);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (error || !data?.data) {
    return (
      <div className="py-12 text-center">
        <p className="text-red-600 dark:text-red-400">
          {(error as Error)?.message || 'Contact not found'}
        </p>
        <button
          onClick={() => router.push('/contacts')}
          className="mt-4 text-primary-600 hover:text-primary-700 text-sm"
        >
          Back to Contacts
        </button>
      </div>
    );
  }

  const contact = data.data;
  const interactions = interactionsData?.data ?? [];

  const handleStatusChange = (newStatus: ContactStatus) => {
    updateStatus.mutate({ contactId: contact.id, status: newStatus });
    setShowStatusChange(false);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Back button */}
      <button
        onClick={() => router.push('/contacts')}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Contacts
      </button>

      {/* Header card */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {contact.firstName} {contact.lastName}
            </h1>
            {contact.headline && (
              <p className="text-gray-500 dark:text-gray-400 mt-1">{contact.headline}</p>
            )}
            <div className="flex items-center gap-3 mt-3">
              <div className="relative">
                <StatusBadge status={contact.status} />
                <button
                  onClick={() => setShowStatusChange(!showStatusChange)}
                  className="ml-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  Change
                </button>
                {showStatusChange && (
                  <div className="absolute top-full mt-1 left-0 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg p-2 z-10">
                    {STATUS_OPTIONS.filter((s) => s !== contact.status).map((s) => (
                      <button
                        key={s}
                        onClick={() => handleStatusChange(s)}
                        className="block w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded"
                      >
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {contact.categories.map((cc) => (
                <span
                  key={cc.categoryId}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                >
                  {cc.category.name}
                </span>
              ))}
              {contact.tags.map((ct) => (
                <span
                  key={ct.tagId}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300"
                >
                  {ct.tag.name}
                </span>
              ))}
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push(`/contacts/${contact.id}/edit`)}
              className="px-3 py-1.5 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 text-sm rounded-md hover:bg-gray-50 dark:hover:bg-slate-800 flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
              Edit
            </button>
            {contact.linkedinUrl && (
              <a
                href={contact.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                </svg>
                LinkedIn
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - Contact info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Details card */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Details</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
              <DetailField label="Company" value={contact.company} />
              <DetailField label="Title" value={contact.title} />
              <DetailField label="Email" value={contact.email} />
              <DetailField label="Phone" value={contact.phone} />
              <DetailField label="Location" value={contact.location} />
              <DetailField label="Seniority" value={contact.seniority} />
              <DetailField label="Introduction Source" value={contact.introductionSource} />
              <DetailField
                label="Mutual Connections"
                value={
                  contact.mutualConnectionsCount > 0 ? String(contact.mutualConnectionsCount) : null
                }
              />
            </dl>
            {contact.notes && (
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-800">
                <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Notes</dt>
                <dd className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                  {contact.notes}
                </dd>
              </div>
            )}
          </div>

          {/* Interaction timeline */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Interactions ({interactions.length})
            </h2>
            {interactions.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No interactions logged yet.
              </p>
            ) : (
              <div className="space-y-3">
                {interactions.map((interaction) => (
                  <div
                    key={interaction.id}
                    className="flex items-start gap-3 py-2 border-b border-gray-50 dark:border-slate-800 last:border-0"
                  >
                    <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-xs font-bold text-primary-700 dark:text-primary-300 shrink-0">
                      {INTERACTION_ICONS[interaction.type] || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {INTERACTION_LABELS[interaction.type] || interaction.type}
                        </span>
                        <span className="text-xs text-gray-400">
                          +{interaction.pointsValue} pts
                        </span>
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {formatDateTime(interaction.occurredAt)} &middot; {interaction.source}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column - Scores and meta */}
        <div className="space-y-6">
          {/* Scores card */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Scores</h2>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Relationship</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {contact.relationshipScore}/100
                  </span>
                </div>
                <ScoreBadge score={contact.relationshipScore} />
              </div>
              {contact.status === 'target' && contact.priorityScore !== null && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Priority</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {Number(contact.priorityScore).toFixed(1)}/10
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-orange-500"
                      style={{ width: `${Number(contact.priorityScore) * 10}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* LinkedIn signals */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              LinkedIn Signals
            </h2>
            <div className="space-y-2">
              <Signal label="Active on LinkedIn" active={contact.isActiveOnLinkedin} />
              <Signal label="Open to Connect" active={contact.hasOpenToConnect} />
              <Signal
                label="Mutual Connections"
                value={
                  contact.mutualConnectionsCount > 0 ? String(contact.mutualConnectionsCount) : '0'
                }
              />
            </div>
          </div>

          {/* Meta info */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Info</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Created</span>
                <span className="text-gray-700 dark:text-gray-300">
                  {formatDate(contact.createdAt)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Updated</span>
                <span className="text-gray-700 dark:text-gray-300">
                  {formatDate(contact.updatedAt)}
                </span>
              </div>
              {contact.lastInteractionAt && (
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Last Interaction</span>
                  <span className="text-gray-700 dark:text-gray-300">
                    {formatDate(contact.lastInteractionAt)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">{value || '-'}</dd>
    </div>
  );
}

function Signal({ label, active, value }: { label: string; active?: boolean; value?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-600 dark:text-gray-400">{label}</span>
      {value !== undefined ? (
        <span className="text-gray-900 dark:text-gray-100">{value}</span>
      ) : (
        <span className={active ? 'text-green-600' : 'text-gray-400'}>{active ? 'Yes' : 'No'}</span>
      )}
    </div>
  );
}
