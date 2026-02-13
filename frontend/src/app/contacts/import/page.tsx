'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

type ImportFormat = 'linkedin' | 'manual';
type WizardStep = 'upload' | 'mapping' | 'preview' | 'importing' | 'results';

interface PreviewData {
  headers: string[];
  sampleRows: string[][];
  totalRows: number;
}

interface ColumnMapping {
  firstName: string;
  lastName: string;
  company?: string;
  title?: string;
  linkedinUrl?: string;
  email?: string;
  phone?: string;
  location?: string;
  notes?: string;
  category?: string;
}

interface ImportResult {
  imported: number;
  duplicatesSkipped: number;
  flaggedForReview: { firstName: string; lastName: string; company: string; reason: string }[];
  errors: { row: number; message: string }[];
  totalRows: number;
}

const MAPPABLE_FIELDS: { key: keyof ColumnMapping; label: string; required?: boolean }[] = [
  { key: 'firstName', label: 'First Name', required: true },
  { key: 'lastName', label: 'Last Name', required: true },
  { key: 'company', label: 'Company' },
  { key: 'title', label: 'Title' },
  { key: 'linkedinUrl', label: 'LinkedIn URL' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'location', label: 'Location' },
  { key: 'notes', label: 'Notes' },
  { key: 'category', label: 'Category' },
];

export default function ImportPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<WizardStep>('upload');
  const [format, setFormat] = useState<ImportFormat>('linkedin');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [showFlagged, setShowFlagged] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.name.endsWith('.csv')) {
        setFile(droppedFile);
        setError(null);
      } else {
        setError('Please upload a CSV file.');
      }
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
    }
  };

  const handleNext = async () => {
    if (!file) return;

    if (format === 'linkedin') {
      // LinkedIn: go straight to import
      setStep('importing');
      setError(null);

      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(`${API_BASE}/import/linkedin`, {
          method: 'POST',
          body: formData,
        });
        const json = await res.json();

        if (!res.ok || !json.success) {
          setError(json.error?.message || 'Import failed');
          setStep('upload');
          return;
        }

        setResult(json.data);
        setStep('results');
        queryClient.invalidateQueries({ queryKey: ['contacts'] });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Import failed');
        setStep('upload');
      }
    } else {
      // Manual CSV: get preview first
      if (step === 'upload') {
        setStep('importing');
        setError(null);

        try {
          const formData = new FormData();
          formData.append('file', file);

          const res = await fetch(`${API_BASE}/import/csv/preview`, {
            method: 'POST',
            body: formData,
          });
          const json = await res.json();

          if (!res.ok || !json.success) {
            setError(json.error?.message || 'Failed to parse CSV');
            setStep('upload');
            return;
          }

          setPreview(json.data);
          setStep('mapping');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to parse CSV');
          setStep('upload');
        }
      } else if (step === 'mapping') {
        // Validate required fields
        if (!mapping.firstName || !mapping.lastName) {
          setError('First Name and Last Name mappings are required.');
          return;
        }
        setStep('preview');
      } else if (step === 'preview') {
        // Execute import
        setStep('importing');
        setError(null);

        try {
          const formData = new FormData();
          formData.append('file', file);

          // Build clean mapping (only non-empty values)
          const cleanMapping: Record<string, string> = {};
          for (const [key, value] of Object.entries(mapping)) {
            if (value) cleanMapping[key] = value;
          }
          formData.append('mapping', JSON.stringify(cleanMapping));

          const res = await fetch(`${API_BASE}/import/csv`, {
            method: 'POST',
            body: formData,
          });
          const json = await res.json();

          if (!res.ok || !json.success) {
            setError(json.error?.message || 'Import failed');
            setStep('preview');
            return;
          }

          setResult(json.data);
          setStep('results');
          queryClient.invalidateQueries({ queryKey: ['contacts'] });
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Import failed');
          setStep('preview');
        }
      }
    }
  };

  const getMappedValue = (row: string[], header: string): string => {
    if (!preview) return '';
    const idx = preview.headers.indexOf(header);
    return idx >= 0 ? row[idx] || '' : '';
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
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

      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Import Contacts</h1>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        <StepIndicator label="Upload" active={step === 'upload'} done={step !== 'upload'} />
        {format === 'manual' && (
          <>
            <StepDivider />
            <StepIndicator
              label="Map Columns"
              active={step === 'mapping'}
              done={step === 'preview' || step === 'importing' || step === 'results'}
            />
            <StepDivider />
            <StepIndicator
              label="Preview"
              active={step === 'preview'}
              done={step === 'importing' || step === 'results'}
            />
          </>
        )}
        <StepDivider />
        <StepIndicator label="Results" active={step === 'results'} done={false} />
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Step: Upload */}
      {step === 'upload' && (
        <div className="space-y-6">
          {/* Format selection */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Import Format
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <FormatOption
                label="LinkedIn Export"
                description="CSV exported from LinkedIn (Connections). Auto-mapped columns."
                selected={format === 'linkedin'}
                onClick={() => setFormat('linkedin')}
              />
              <FormatOption
                label="Manual CSV"
                description="Custom CSV file. You'll map columns to contact fields."
                selected={format === 'manual'}
                onClick={() => setFormat('manual')}
              />
            </div>
          </div>

          {/* File dropzone */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Upload CSV File
            </h2>
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                dragActive
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : file
                    ? 'border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-900/20'
                    : 'border-gray-300 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="hidden"
              />
              {file ? (
                <div>
                  <svg
                    className="w-10 h-10 mx-auto text-green-500 mb-2"
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
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              ) : (
                <div>
                  <svg
                    className="w-10 h-10 mx-auto text-gray-400 mb-2"
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
                    Drag & drop your CSV file here, or{' '}
                    <span className="text-primary-600 font-medium">browse</span>
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    CSV files up to 10MB
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Next button */}
          <div className="flex justify-end">
            <button
              onClick={handleNext}
              disabled={!file}
              className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {format === 'linkedin' ? 'Import' : 'Next: Map Columns'}
            </button>
          </div>
        </div>
      )}

      {/* Step: Column Mapping */}
      {step === 'mapping' && preview && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              Map Columns
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Map your CSV columns to contact fields. {preview.totalRows} rows detected.
            </p>
            <div className="space-y-3">
              {MAPPABLE_FIELDS.map((field) => (
                <div key={field.key} className="flex items-center gap-4">
                  <label className="w-32 text-sm font-medium text-gray-700 dark:text-gray-300 text-right shrink-0">
                    {field.label}
                    {field.required && <span className="text-red-500 ml-0.5">*</span>}
                  </label>
                  <select
                    value={mapping[field.key] || ''}
                    onChange={(e) =>
                      setMapping((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    className="flex-1 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2"
                  >
                    <option value="">-- Skip --</option>
                    {preview.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  {mapping[field.key] && preview.sampleRows.length > 0 && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 w-40 truncate">
                      e.g. &quot;{getMappedValue(preview.sampleRows[0], mapping[field.key])}&quot;
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => {
                setStep('upload');
                setError(null);
              }}
              className="px-4 py-2 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800"
            >
              Back
            </button>
            <button
              onClick={handleNext}
              className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700"
            >
              Next: Preview
            </button>
          </div>
        </div>
      )}

      {/* Step: Preview */}
      {step === 'preview' && preview && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              Preview Import
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Showing first {preview.sampleRows.length} of {preview.totalRows} rows.
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700 text-sm">
                <thead>
                  <tr>
                    {MAPPABLE_FIELDS.filter((f) => mapping[f.key]).map((f) => (
                      <th
                        key={f.key}
                        className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase"
                      >
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {preview.sampleRows.map((row, i) => (
                    <tr key={i}>
                      {MAPPABLE_FIELDS.filter((f) => mapping[f.key]).map((f) => (
                        <td
                          key={f.key}
                          className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap"
                        >
                          {getMappedValue(row, mapping[f.key]!) || '-'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => {
                setStep('mapping');
                setError(null);
              }}
              className="px-4 py-2 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800"
            >
              Back
            </button>
            <button
              onClick={handleNext}
              className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700"
            >
              Import {preview.totalRows} Rows
            </button>
          </div>
        </div>
      )}

      {/* Step: Importing */}
      {step === 'importing' && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-12 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Importing contacts...</p>
        </div>
      )}

      {/* Step: Results */}
      {step === 'results' && result && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Import Complete
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Imported" value={result.imported} color="green" />
              <StatCard
                label="Duplicates Skipped"
                value={result.duplicatesSkipped}
                color="yellow"
              />
              <StatCard
                label="Flagged for Review"
                value={result.flaggedForReview.length}
                color="blue"
              />
              <StatCard label="Errors" value={result.errors.length} color="red" />
            </div>
          </div>

          {/* Flagged for review */}
          {result.flaggedForReview.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
              <button
                onClick={() => setShowFlagged(!showFlagged)}
                className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white"
              >
                <svg
                  className={`w-4 h-4 transition-transform ${showFlagged ? 'rotate-90' : ''}`}
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
                Flagged for Review ({result.flaggedForReview.length})
              </button>
              {showFlagged && (
                <div className="mt-3 space-y-2">
                  {result.flaggedForReview.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400"
                    >
                      <span className="font-medium text-gray-900 dark:text-white">
                        {item.firstName} {item.lastName}
                      </span>
                      <span>{item.company}</span>
                      <span className="text-xs text-yellow-600 dark:text-yellow-400">
                        {item.reason}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Errors */}
          {result.errors.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
              <button
                onClick={() => setShowErrors(!showErrors)}
                className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white"
              >
                <svg
                  className={`w-4 h-4 transition-transform ${showErrors ? 'rotate-90' : ''}`}
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
                Errors ({result.errors.length})
              </button>
              {showErrors && (
                <div className="mt-3 space-y-1">
                  {result.errors.map((err, i) => (
                    <div key={i} className="text-sm text-red-600 dark:text-red-400">
                      Row {err.row}: {err.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <button
              onClick={() => {
                setStep('upload');
                setFile(null);
                setPreview(null);
                setMapping({});
                setResult(null);
                setError(null);
              }}
              className="px-4 py-2 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800"
            >
              Import More
            </button>
            <button
              onClick={() => router.push('/contacts')}
              className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700"
            >
              View Contacts
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepIndicator({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <span
      className={`px-3 py-1 rounded-full text-xs font-medium ${
        active
          ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
          : done
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
            : 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-gray-400'
      }`}
    >
      {label}
    </span>
  );
}

function StepDivider() {
  return (
    <svg
      className="w-4 h-4 text-gray-300 dark:text-gray-600"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function FormatOption({
  label,
  description,
  selected,
  onClick,
}: {
  label: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-4 rounded-lg border-2 text-left transition-colors ${
        selected
          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 dark:border-primary-700'
          : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600'
      }`}
    >
      <p className="font-medium text-gray-900 dark:text-white text-sm">{label}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{description}</p>
    </button>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: 'green' | 'yellow' | 'blue' | 'red';
}) {
  const colorClasses = {
    green: 'text-green-600 dark:text-green-400',
    yellow: 'text-yellow-600 dark:text-yellow-400',
    blue: 'text-blue-600 dark:text-blue-400',
    red: 'text-red-600 dark:text-red-400',
  };

  return (
    <div className="text-center">
      <p className={`text-2xl font-bold ${colorClasses[color]}`}>{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
    </div>
  );
}
