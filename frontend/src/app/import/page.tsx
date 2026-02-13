'use client';

import React, { useState, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

type ImportType = 'connections' | 'messages' | 'invitations';

interface ConnectionsResult {
  imported: number;
  duplicatesSkipped: number;
  flaggedForReview: { firstName: string; lastName: string; company: string; reason: string }[];
  errors: { row: number; message: string }[];
  totalRows: number;
}

interface MessagesResult {
  totalParsed: number;
  matched: number;
  interactionsCreated: number;
  unmatchedSkipped: number;
  duplicatesSkipped: number;
  errors: { row: number; message: string }[];
  scoresRecalculated: number;
  userLinkedinUrl: string;
}

interface InvitationsResult {
  totalParsed: number;
  matched: number;
  interactionsCreated: number;
  unmatchedSkipped: number;
  duplicatesSkipped: number;
  errors: { row: number; message: string }[];
  scoresRecalculated: number;
}

type ImportResult = ConnectionsResult | MessagesResult | InvitationsResult;
type ImportStep = 'select' | 'upload' | 'importing' | 'result';

const IMPORT_TYPES: { key: ImportType; label: string; description: string; file: string }[] = [
  {
    key: 'connections',
    label: 'Connections',
    description: 'Import your LinkedIn connections to create contacts',
    file: 'Connections.csv',
  },
  {
    key: 'messages',
    label: 'Messages',
    description: 'Import message history to backfill interaction data and scores',
    file: 'messages.csv',
  },
  {
    key: 'invitations',
    label: 'Invitations',
    description: 'Import invitation history to track connection request activity',
    file: 'Invitations.csv',
  },
];

const API_ENDPOINTS: Record<ImportType, string> = {
  connections: '/import/linkedin',
  messages: '/import/linkedin-messages',
  invitations: '/import/linkedin-invitations',
};

export default function ImportPage() {
  const [step, setStep] = useState<ImportStep>('select');
  const [importType, setImportType] = useState<ImportType>('connections');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.name.endsWith('.csv')) {
      setFile(droppedFile);
      setError(null);
    } else {
      setError('Please drop a CSV file');
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setError(null);
    }
  }, []);

  function selectType(type: ImportType) {
    setImportType(type);
    setStep('upload');
    setFile(null);
    setError(null);
    setResult(null);
  }

  async function handleImport() {
    if (!file) return;

    setStep('importing');
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_BASE}${API_ENDPOINTS[importType]}`, {
        method: 'POST',
        body: formData,
      });

      const body = await res.json();

      if (!res.ok || !body.success) {
        setError(body.error?.message || 'Import failed');
        setStep('upload');
        return;
      }

      setResult(body.data);
      setStep('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setStep('upload');
    }
  }

  function handleReset() {
    setStep('select');
    setFile(null);
    setError(null);
    setResult(null);
  }

  const currentTypeInfo = IMPORT_TYPES.find((t) => t.key === importType)!;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Import LinkedIn Data</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Import your LinkedIn data export to populate contacts, messages, and invitations
        </p>
      </div>

      {/* Instructions */}
      {(step === 'select' || step === 'upload') && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-2">
            How to export your LinkedIn data
          </h3>
          <ol className="text-sm text-blue-700 dark:text-blue-400 space-y-1 list-decimal list-inside">
            <li>
              Go to{' '}
              <span className="font-medium">
                LinkedIn &rarr; Settings &rarr; Data Privacy &rarr; Get a copy of your data
              </span>
            </li>
            <li>
              Select the data you want (Connections, Messages, Invitations) and request the archive
            </li>
            <li>Download the ZIP file when ready (usually takes a few minutes)</li>
            <li>Extract the ZIP and find the CSV files</li>
            <li>Upload them below &mdash; start with Connections, then Messages and Invitations</li>
          </ol>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Type selection step */}
      {step === 'select' && (
        <div className="space-y-3">
          {IMPORT_TYPES.map((type) => (
            <button
              key={type.key}
              onClick={() => selectType(type.key)}
              className="w-full text-left p-4 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg hover:border-primary-400 dark:hover:border-primary-500 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{type.label}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                    {type.description}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    File: <span className="font-mono">{type.file}</span>
                  </p>
                </div>
                <svg
                  className="w-5 h-5 text-gray-400"
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
            </button>
          ))}
        </div>
      )}

      {/* Upload step */}
      {step === 'upload' && (
        <div className="space-y-4">
          {/* Back button */}
          <button
            onClick={() => setStep('select')}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back to import type selection
          </button>

          <div className="p-3 bg-gray-50 dark:bg-slate-800 rounded-lg">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Importing: {currentTypeInfo.label}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Upload your <span className="font-mono">{currentTypeInfo.file}</span> file
            </p>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragOver
                ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20'
                : file
                  ? 'border-green-400 bg-green-50 dark:bg-green-900/20'
                  : 'border-gray-300 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500'
            }`}
          >
            {file ? (
              <div className="space-y-2">
                <svg
                  className="mx-auto h-10 w-10 text-green-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-sm font-medium text-gray-900 dark:text-white">{file.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
                <button
                  onClick={() => setFile(null)}
                  className="text-xs text-red-600 dark:text-red-400 hover:underline"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <svg
                  className="mx-auto h-10 w-10 text-gray-400 dark:text-gray-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Drag and drop your <span className="font-medium">{currentTypeInfo.file}</span>{' '}
                  here
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">or</p>
                <label className="inline-block px-4 py-2 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-600">
                  Browse files
                  <input type="file" accept=".csv" onChange={handleFileSelect} className="hidden" />
                </label>
              </div>
            )}
          </div>

          {/* Import button */}
          <button
            onClick={handleImport}
            disabled={!file}
            className="w-full px-4 py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Import {currentTypeInfo.label}
          </button>
        </div>
      )}

      {/* Importing step */}
      {step === 'importing' && (
        <div className="text-center py-12 space-y-4">
          <div className="inline-block animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
          <p className="text-gray-600 dark:text-gray-400">
            Importing {currentTypeInfo.label.toLowerCase()}...
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            This may take a moment for large files
          </p>
        </div>
      )}

      {/* Result step — Connections */}
      {step === 'result' && result && importType === 'connections' && (
        <ConnectionsResultView result={result as ConnectionsResult} onReset={handleReset} />
      )}

      {/* Result step — Messages */}
      {step === 'result' && result && importType === 'messages' && (
        <MessagesResultView result={result as MessagesResult} onReset={handleReset} />
      )}

      {/* Result step — Invitations */}
      {step === 'result' && result && importType === 'invitations' && (
        <InvitationsResultView result={result as InvitationsResult} onReset={handleReset} />
      )}
    </div>
  );
}

function ConnectionsResultView({
  result,
  onReset,
}: {
  result: ConnectionsResult;
  onReset: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Import Complete
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <StatCard value={result.imported} label="Contacts imported" color="green" />
          <StatCard value={result.totalRows} label="Total rows in CSV" color="gray" />
          {result.duplicatesSkipped > 0 && (
            <StatCard value={result.duplicatesSkipped} label="Duplicates skipped" color="yellow" />
          )}
          {result.errors.length > 0 && (
            <StatCard value={result.errors.length} label="Errors" color="red" />
          )}
        </div>
      </div>
      {result.flaggedForReview.length > 0 && <FlaggedList items={result.flaggedForReview} />}
      <ErrorList errors={result.errors} />
      <ResultActions onReset={onReset} />
    </div>
  );
}

function MessagesResultView({ result, onReset }: { result: MessagesResult; onReset: () => void }) {
  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Messages Import Complete
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <StatCard value={result.interactionsCreated} label="Interactions created" color="green" />
          <StatCard value={result.totalParsed} label="Total messages parsed" color="gray" />
          <StatCard value={result.matched} label="Matched to contacts" color="blue" />
          <StatCard value={result.unmatchedSkipped} label="Unmatched (skipped)" color="yellow" />
          {result.duplicatesSkipped > 0 && (
            <StatCard value={result.duplicatesSkipped} label="Duplicates skipped" color="yellow" />
          )}
          <StatCard value={result.scoresRecalculated} label="Scores recalculated" color="blue" />
        </div>
        {result.userLinkedinUrl && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
            Detected your profile: {result.userLinkedinUrl}
          </p>
        )}
      </div>
      <ErrorList errors={result.errors} />
      <ResultActions onReset={onReset} />
    </div>
  );
}

function InvitationsResultView({
  result,
  onReset,
}: {
  result: InvitationsResult;
  onReset: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Invitations Import Complete
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <StatCard value={result.interactionsCreated} label="Interactions created" color="green" />
          <StatCard value={result.totalParsed} label="Total invitations parsed" color="gray" />
          <StatCard value={result.matched} label="Matched to contacts" color="blue" />
          <StatCard value={result.unmatchedSkipped} label="Unmatched (skipped)" color="yellow" />
          {result.duplicatesSkipped > 0 && (
            <StatCard value={result.duplicatesSkipped} label="Duplicates skipped" color="yellow" />
          )}
          <StatCard value={result.scoresRecalculated} label="Scores recalculated" color="blue" />
        </div>
      </div>
      <ErrorList errors={result.errors} />
      <ResultActions onReset={onReset} />
    </div>
  );
}

function StatCard({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: 'green' | 'gray' | 'yellow' | 'red' | 'blue';
}) {
  const styles: Record<string, string> = {
    green: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    gray: 'bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-gray-400',
    yellow: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
  };
  const labelStyles: Record<string, string> = {
    green: 'text-green-700 dark:text-green-300',
    gray: 'text-gray-500',
    yellow: 'text-yellow-700 dark:text-yellow-300',
    red: 'text-red-700 dark:text-red-300',
    blue: 'text-blue-700 dark:text-blue-300',
  };
  return (
    <div className={`text-center p-3 rounded-lg ${styles[color]}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className={`text-xs ${labelStyles[color]}`}>{label}</p>
    </div>
  );
}

function FlaggedList({
  items,
}: {
  items: { firstName: string; lastName: string; company: string; reason: string }[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-2">
        Flagged for review ({items.length})
      </h3>
      <ul className="text-sm text-yellow-700 dark:text-yellow-400 space-y-1">
        {items.slice(0, 10).map((f, i) => (
          <li key={i}>
            {f.firstName} {f.lastName} at {f.company} &mdash; {f.reason}
          </li>
        ))}
        {items.length > 10 && <li className="text-yellow-600">...and {items.length - 10} more</li>}
      </ul>
    </div>
  );
}

function ErrorList({ errors }: { errors: { row: number; message: string }[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-red-800 dark:text-red-300 mb-2">
        Errors ({errors.length})
      </h3>
      <ul className="text-sm text-red-700 dark:text-red-400 space-y-1">
        {errors.slice(0, 10).map((e, i) => (
          <li key={i}>
            Row {e.row}: {e.message}
          </li>
        ))}
        {errors.length > 10 && <li className="text-red-600">...and {errors.length - 10} more</li>}
      </ul>
    </div>
  );
}

function ResultActions({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex gap-3">
      <button
        onClick={onReset}
        className="flex-1 px-4 py-2 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-600"
      >
        Import Another File
      </button>
      <a
        href="/contacts"
        className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium text-center hover:bg-primary-700"
      >
        View Contacts
      </a>
    </div>
  );
}
