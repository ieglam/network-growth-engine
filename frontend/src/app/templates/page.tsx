'use client';

import { useState, useMemo, useCallback } from 'react';
import type { Template } from '@/lib/types';
import {
  useTemplates,
  useCreateTemplate,
  useUpdateTemplate,
  useDeleteTemplate,
} from '@/hooks/useTemplates';
import { useCategoriesWithCounts } from '@/hooks/useCategoryManagement';

const MAX_CHARS = 300;
const WARN_CHARS = 280;

const TOKENS = [
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'company', label: 'Company' },
  { key: 'title', label: 'Title' },
  { key: 'mutual_connection', label: 'Mutual Connection' },
  { key: 'recent_post', label: 'Recent Post' },
  { key: 'category_context', label: 'Category Context' },
  { key: 'custom', label: 'Custom' },
] as const;

const SAMPLE_DATA: Record<string, string> = {
  first_name: 'Alex',
  last_name: 'Johnson',
  company: 'TechCorp',
  title: 'VP of Engineering',
  mutual_connection: 'Sarah Miller',
  recent_post: 'AI in fintech',
  category_context: 'tech leaders',
  custom: '',
};

function renderPreview(body: string, data: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => {
    return data[token] ?? '';
  });
}

interface TemplateFormData {
  name: string;
  categoryId: string;
  subject: string;
  body: string;
  isActive: boolean;
}

const emptyForm: TemplateFormData = {
  name: '',
  categoryId: '',
  subject: '',
  body: '',
  isActive: true,
};

export default function TemplatesPage() {
  const { data: templatesData, isLoading } = useTemplates();
  const { data: categoriesData } = useCategoriesWithCounts();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const deleteTemplate = useDeleteTemplate();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateFormData>(emptyForm);
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const templates = useMemo(() => templatesData?.data ?? [], [templatesData?.data]);
  const categories = useMemo(() => categoriesData?.data ?? [], [categoriesData?.data]);

  const usedCategoryIds = useMemo(() => {
    const set = new Set(templates.map((t) => t.categoryId).filter(Boolean) as string[]);
    return Array.from(set);
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    if (!categoryFilter) return templates;
    if (categoryFilter === '__none__') return templates.filter((t) => !t.categoryId);
    return templates.filter((t) => t.categoryId === categoryFilter);
  }, [templates, categoryFilter]);

  const preview = useMemo(() => renderPreview(form.body, SAMPLE_DATA), [form.body]);
  const charCount = form.body.length;
  const previewCharCount = preview.length;

  const charColor =
    charCount > MAX_CHARS
      ? 'text-red-600 dark:text-red-400'
      : charCount >= WARN_CHARS
        ? 'text-yellow-600 dark:text-yellow-400'
        : 'text-gray-500 dark:text-gray-400';

  const previewCharColor =
    previewCharCount > MAX_CHARS
      ? 'text-red-600 dark:text-red-400'
      : previewCharCount >= WARN_CHARS
        ? 'text-yellow-600 dark:text-yellow-400'
        : 'text-gray-500 dark:text-gray-400';

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }, []);

  const openEdit = useCallback((t: Template) => {
    setEditingId(t.id);
    setForm({
      name: t.name,
      categoryId: t.categoryId ?? '',
      subject: t.subject ?? '',
      body: t.body,
      isActive: t.isActive,
    });
    setShowForm(true);
  }, []);

  const closeForm = useCallback(() => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  }, []);

  const insertToken = useCallback(
    (token: string) => {
      const textarea = document.getElementById('template-body') as HTMLTextAreaElement | null;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const insert = `{{${token}}}`;
      const newBody = form.body.slice(0, start) + insert + form.body.slice(end);
      setForm((f) => ({ ...f, body: newBody }));

      // Restore cursor position after React re-renders
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(start + insert.length, start + insert.length);
      });
    },
    [form.body]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (charCount > MAX_CHARS) return;

      const payload = {
        name: form.name,
        categoryId: form.categoryId || null,
        body: form.body,
        isActive: form.isActive,
        ...(form.subject ? { subject: form.subject } : {}),
      };

      if (editingId) {
        await updateTemplate.mutateAsync({ id: editingId, data: payload });
      } else {
        await createTemplate.mutateAsync(payload);
      }
      closeForm();
    },
    [form, charCount, editingId, updateTemplate, createTemplate, closeForm]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteTemplate.mutateAsync(id);
      setDeleteConfirmId(null);
    },
    [deleteTemplate]
  );

  const handleToggleActive = useCallback(
    async (t: Template) => {
      await updateTemplate.mutateAsync({
        id: t.id,
        data: { isActive: !t.isActive },
      });
    },
    [updateTemplate]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Templates</h1>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          + New Template
        </button>
      </div>

      {/* Category filter */}
      {usedCategoryIds.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-sm text-gray-500 dark:text-gray-400">Filter by category:</span>
          <button
            onClick={() => setCategoryFilter('')}
            className={`px-3 py-1 text-sm rounded-full ${
              !categoryFilter
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            All
          </button>
          {usedCategoryIds.map((catId) => {
            const cat = categories.find((c) => c.id === catId);
            return (
              <button
                key={catId}
                onClick={() => setCategoryFilter(catId)}
                className={`px-3 py-1 text-sm rounded-full ${
                  categoryFilter === catId
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {cat?.name ?? 'Unknown'}
              </button>
            );
          })}
          <button
            onClick={() => setCategoryFilter('__none__')}
            className={`px-3 py-1 text-sm rounded-full ${
              categoryFilter === '__none__'
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            Generic
          </button>
        </div>
      )}

      {/* Template Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-12 px-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                  {editingId ? 'Edit Template' : 'New Template'}
                </h2>
                <button
                  onClick={closeForm}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Template Name *
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    required
                    maxLength={100}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="e.g. Tech Leader Intro"
                  />
                </div>

                {/* Category */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Category{' '}
                    <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
                  </label>
                  <select
                    value={form.categoryId}
                    onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Generic (no category)</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Subject (optional) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Subject{' '}
                    <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={form.subject}
                    onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                    maxLength={200}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="e.g. Connection request subject"
                  />
                </div>

                {/* Token insertion toolbar */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Insert Token
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {TOKENS.map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => insertToken(t.key)}
                        className="px-2 py-1 text-xs font-mono bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-900/50"
                      >
                        {'{{'}
                        {t.key}
                        {'}}'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Body */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Message Body *
                    </label>
                    <span className={`text-sm font-medium ${charColor}`}>
                      {charCount}/{MAX_CHARS}
                      {charCount > MAX_CHARS && ' — over limit!'}
                    </span>
                  </div>
                  <textarea
                    id="template-body"
                    value={form.body}
                    onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                    required
                    rows={5}
                    className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm ${
                      charCount > MAX_CHARS
                        ? 'border-red-400 dark:border-red-500'
                        : charCount >= WARN_CHARS
                          ? 'border-yellow-400 dark:border-yellow-500'
                          : 'border-gray-300 dark:border-gray-600'
                    }`}
                    placeholder="Hi {{first_name}}, I noticed we both work in..."
                  />
                  {charCount >= WARN_CHARS && charCount <= MAX_CHARS && (
                    <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                      Approaching LinkedIn&apos;s 300-character limit
                    </p>
                  )}
                  {charCount > MAX_CHARS && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                      Exceeds LinkedIn&apos;s 300-character limit. Please shorten the message.
                    </p>
                  )}
                </div>

                {/* Live Preview */}
                {form.body.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        Live Preview
                      </label>
                      <span className={`text-sm font-medium ${previewCharColor}`}>
                        Rendered: {previewCharCount}/{MAX_CHARS}
                      </span>
                    </div>
                    <div className="p-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                      {preview}
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      Sample data: {SAMPLE_DATA.first_name} {SAMPLE_DATA.last_name} at{' '}
                      {SAMPLE_DATA.company}
                    </p>
                  </div>
                )}

                {/* Active toggle */}
                <div className="flex items-center gap-3">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:after:border-gray-600 peer-checked:bg-blue-600"></div>
                  </label>
                  <span className="text-sm text-gray-700 dark:text-gray-300">Active</span>
                </div>

                {/* Buttons */}
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeForm}
                    className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      charCount > MAX_CHARS ||
                      createTemplate.isPending ||
                      updateTemplate.isPending ||
                      !form.name ||
                      !form.body
                    }
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {createTemplate.isPending || updateTemplate.isPending
                      ? 'Saving...'
                      : editingId
                        ? 'Save Changes'
                        : 'Create Template'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Template List */}
      {filteredTemplates.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <p className="text-gray-500 dark:text-gray-400">
            {templates.length === 0
              ? 'No templates yet. Create your first one!'
              : 'No templates match the selected filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTemplates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onEdit={() => openEdit(t)}
              onDelete={() => setDeleteConfirmId(t.id)}
              onToggleActive={() => handleToggleActive(t)}
            />
          ))}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
              Delete Template?
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              This template will be permanently deleted. Queue items using it will not be affected.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                disabled={deleteTemplate.isPending}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteTemplate.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  onEdit,
  onDelete,
  onToggleActive,
}: {
  template: Template;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const t = template;

  const acceptanceRate = t.timesUsed > 0 ? Math.round((t.acceptances / t.timesUsed) * 100) : 0;
  const responseRate = t.timesUsed > 0 ? Math.round((t.responses / t.timesUsed) * 100) : 0;
  const hasEnoughData = t.timesUsed >= 20;
  const preview = renderPreview(t.body, SAMPLE_DATA);

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-xl border ${
        t.isActive
          ? 'border-gray-200 dark:border-gray-700'
          : 'border-gray-200 dark:border-gray-700 opacity-60'
      }`}
    >
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                {t.name}
              </h3>
              {!t.isActive && (
                <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 rounded-full">
                  Inactive
                </span>
              )}
              {!hasEnoughData && t.timesUsed > 0 && (
                <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 rounded-full">
                  Low sample
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 px-2 py-0.5 rounded-full">
                {t.category?.name ?? 'Generic'}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Used {t.timesUsed} time{t.timesUsed !== 1 ? 's' : ''}
              </span>
              {hasEnoughData && (
                <>
                  <span className="text-xs text-green-600 dark:text-green-400">
                    {acceptanceRate}% accepted
                  </span>
                  <span className="text-xs text-blue-600 dark:text-blue-400">
                    {responseRate}% response
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={onToggleActive}
              title={t.isActive ? 'Deactivate' : 'Activate'}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
            >
              {t.isActive ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                  />
                </svg>
              )}
            </button>
            <button
              onClick={onEdit}
              className="p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 rounded"
              title="Edit"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded"
              title="Delete"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Collapsed body preview */}
        <button onClick={() => setExpanded(!expanded)} className="w-full text-left mt-2">
          <p className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">{t.body}</p>
        </button>

        {/* Expanded view */}
        {expanded && (
          <div className="mt-3 space-y-3 pt-3 border-t border-gray-100 dark:border-gray-700">
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Raw Template
              </p>
              <pre className="text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 p-3 rounded-lg whitespace-pre-wrap font-mono">
                {t.body}
              </pre>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                {t.body.length}/{MAX_CHARS} characters
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Preview (with sample data)
              </p>
              <div className="text-xs text-gray-700 dark:text-gray-300 bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg whitespace-pre-wrap">
                {preview}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Rendered: {preview.length}/{MAX_CHARS} characters
              </p>
            </div>

            {/* Performance stats for templates with 20+ uses */}
            {hasEnoughData && (
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                  Performance Stats
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-gray-50 dark:bg-gray-900 p-2 rounded-lg text-center">
                    <p className="text-lg font-bold text-gray-900 dark:text-white">{t.timesUsed}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Times Used</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-900 p-2 rounded-lg text-center">
                    <p className="text-lg font-bold text-green-600 dark:text-green-400">
                      {acceptanceRate}%
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Acceptance Rate</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-900 p-2 rounded-lg text-center">
                    <p className="text-lg font-bold text-blue-600 dark:text-blue-400">
                      {responseRate}%
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Response Rate</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
