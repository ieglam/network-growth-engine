'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import {
  useStartSearch,
  useSearchProgress,
  useSearchHistory,
  useImportProspects,
  useRegenerateQueue,
  type SearchCriteria,
  type ScrapedProspect,
} from '@/hooks/useLinkedInSearch';

function TagInput({
  label,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (_values: string[]) => void;
}) {
  const [input, setInput] = useState('');

  const addTag = () => {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
      setInput('');
    }
  };

  const removeTag = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}
      </label>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {values.map((val, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 text-sm rounded-full"
          >
            {val}
            <button
              onClick={() => removeTag(i)}
              className="hover:text-primary-900 dark:hover:text-primary-100"
            >
              &times;
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder={placeholder}
          className="flex-1 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <button
          onClick={addTag}
          type="button"
          className="px-3 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 text-sm rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600"
        >
          Add
        </button>
      </div>
    </div>
  );
}

export default function FindTargetsPage() {
  const [jobTitles, setJobTitles] = useState<string[]>([
    'Compliance Officer',
    'Regulatory Affairs',
  ]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>(['Cryptocurrency', 'Financial Services']);
  const [keywords, setKeywords] = useState('');
  const [location, setLocation] = useState('');
  const [maxResults, setMaxResults] = useState(50);

  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [importResult, setImportResult] = useState<{
    imported: number;
    duplicatesSkipped: number;
    errors: number;
  } | null>(null);

  const startSearch = useStartSearch();
  const { data: progressData } = useSearchProgress(isSearching);
  const { data: historyData } = useSearchHistory();
  const importProspects = useImportProspects();
  const regenerateQueue = useRegenerateQueue();

  const progress = progressData?.data?.progress;
  const results: ScrapedProspect[] = useMemo(
    () => progressData?.data?.results ?? [],
    [progressData?.data?.results]
  );
  const history = historyData?.data ?? [];

  // Track search completion
  useEffect(() => {
    if (progress?.status === 'complete' || progress?.status === 'error') {
      setIsSearching(false);
    }
  }, [progress?.status]);

  const handleSearch = () => {
    const criteria: SearchCriteria = {
      maxResults,
    };
    if (jobTitles.length > 0) criteria.jobTitles = jobTitles;
    if (companies.length > 0) criteria.companies = companies;
    if (industries.length > 0) criteria.industries = industries;
    if (keywords.trim()) criteria.keywords = keywords.trim();
    if (location.trim()) criteria.location = location.trim();

    setIsSearching(true);
    setImportResult(null);
    setSelectedUrls(new Set());
    startSearch.mutate(criteria);
  };

  const toggleSelect = (url: string) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedUrls.size === results.length) {
      setSelectedUrls(new Set());
    } else {
      setSelectedUrls(new Set(results.map((r) => r.linkedinUrl)));
    }
  };

  const selectedProspects = useMemo(
    () => results.filter((r) => selectedUrls.has(r.linkedinUrl)),
    [results, selectedUrls]
  );

  const handleImport = () => {
    if (selectedProspects.length === 0) return;
    importProspects.mutate(selectedProspects, {
      onSuccess: (data) => {
        setImportResult(data.data);
        setSelectedUrls(new Set());
      },
    });
  };

  const handleRegenerateQueue = () => {
    regenerateQueue.mutate();
  };

  const isRunning =
    isSearching ||
    progress?.status === 'searching' ||
    progress?.status === 'scraping' ||
    progress?.status === 'initializing';

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Find Targets</h1>

      {/* Search Form */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Search Criteria</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TagInput
            label="Job Titles"
            placeholder="e.g. Compliance Officer"
            values={jobTitles}
            onChange={setJobTitles}
          />
          <TagInput
            label="Companies"
            placeholder="e.g. Coinbase"
            values={companies}
            onChange={setCompanies}
          />
          <TagInput
            label="Industries"
            placeholder="e.g. Financial Services"
            values={industries}
            onChange={setIndustries}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Keywords
            </label>
            <input
              type="text"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="Additional search keywords"
              className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Location
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. New York, United States"
              className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Max Results
            </label>
            <input
              type="number"
              value={maxResults}
              onChange={(e) => setMaxResults(Math.min(100, Math.max(1, Number(e.target.value))))}
              min={1}
              max={100}
              className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSearch}
            disabled={isRunning || startSearch.isPending}
            className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRunning ? 'Searching...' : 'Search LinkedIn'}
          </button>
          {isRunning && (
            <div className="flex items-center gap-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600" />
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {progress?.message || 'Starting...'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      {isRunning && progress && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Page {progress.currentPage} &middot; {progress.scraped} found
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">
              {progress.status}
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2">
            <div
              className="bg-primary-600 h-2 rounded-full transition-all"
              style={{ width: `${Math.min(100, (progress.scraped / maxResults) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Error State */}
      {progress?.status === 'error' && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-700 dark:text-red-300 text-sm">{progress.message}</p>
        </div>
      )}

      {/* Import Success */}
      {importResult && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 space-y-2">
          <p className="text-green-700 dark:text-green-300 text-sm font-medium">Import Complete</p>
          <div className="flex items-center gap-4 text-sm text-green-600 dark:text-green-400">
            <span>{importResult.imported} imported</span>
            <span>{importResult.duplicatesSkipped} duplicates skipped</span>
            {importResult.errors > 0 && <span>{importResult.errors} errors</span>}
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleRegenerateQueue}
              disabled={regenerateQueue.isPending}
              className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {regenerateQueue.isPending ? 'Regenerating...' : 'Regenerate Queue'}
            </button>
            <Link
              href="/queue"
              className="text-sm text-green-600 dark:text-green-400 hover:underline"
            >
              View Queue
            </Link>
          </div>
          {regenerateQueue.isSuccess && (
            <p className="text-xs text-green-600 dark:text-green-400">
              Queue regenerated successfully!{' '}
              <Link href="/queue" className="underline">
                View queue
              </Link>
            </p>
          )}
        </div>
      )}

      {/* Results Table */}
      {results.length > 0 && !isRunning && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-slate-700">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Results ({results.length})
            </h2>
            <div className="flex items-center gap-2">
              {selectedUrls.size > 0 && (
                <button
                  onClick={handleImport}
                  disabled={importProspects.isPending}
                  className="px-3 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50"
                >
                  {importProspects.isPending
                    ? 'Importing...'
                    : `Import Selected (${selectedUrls.size})`}
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-slate-800 text-left">
                  <th className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={selectedUrls.size === results.length && results.length > 0}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                  </th>
                  <th className="px-4 py-2 text-gray-600 dark:text-gray-400 font-medium">Name</th>
                  <th className="px-4 py-2 text-gray-600 dark:text-gray-400 font-medium">Title</th>
                  <th className="px-4 py-2 text-gray-600 dark:text-gray-400 font-medium">
                    Company
                  </th>
                  <th className="px-4 py-2 text-gray-600 dark:text-gray-400 font-medium">
                    Location
                  </th>
                  <th className="px-4 py-2 text-gray-600 dark:text-gray-400 font-medium">Mutual</th>
                  <th className="px-4 py-2 text-gray-600 dark:text-gray-400 font-medium">
                    Profile
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((prospect) => (
                  <tr
                    key={prospect.linkedinUrl}
                    className={`border-t border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50 ${
                      selectedUrls.has(prospect.linkedinUrl)
                        ? 'bg-primary-50 dark:bg-primary-900/10'
                        : ''
                    }`}
                  >
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedUrls.has(prospect.linkedinUrl)}
                        onChange={() => toggleSelect(prospect.linkedinUrl)}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                    </td>
                    <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">
                      {prospect.fullName}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">
                      {prospect.title || '-'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">
                      {prospect.company || '-'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">
                      {prospect.location || '-'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 text-center">
                      {prospect.mutualConnectionsCount || '-'}
                    </td>
                    <td className="px-4 py-2.5">
                      <a
                        href={prospect.linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary-600 dark:text-primary-400 hover:underline text-xs"
                      >
                        View
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Search History */}
      {history.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            Search History
          </h2>
          <div className="space-y-2">
            {history.slice(0, 10).map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between text-sm border-b border-gray-100 dark:border-slate-800 pb-2 last:border-0"
              >
                <div>
                  <span className="text-gray-700 dark:text-gray-300">
                    {[
                      entry.criteria.jobTitles?.join(', '),
                      entry.criteria.industries?.join(', '),
                      entry.criteria.location,
                      entry.criteria.keywords,
                    ]
                      .filter(Boolean)
                      .join(' / ') || 'General search'}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                  <span>{entry.resultCount} found</span>
                  <span>{entry.importedCount} imported</span>
                  <span>{new Date(entry.searchedAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
