'use client';

import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCategories, useTags } from '@/hooks/useContacts';
import type { Contact } from '@/lib/types';

const contactFormSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  title: z.string().max(200).optional().or(z.literal('')),
  company: z.string().max(200).optional().or(z.literal('')),
  linkedinUrl: z.string().max(500).optional().or(z.literal('')),
  email: z.string().email('Invalid email format').max(200).optional().or(z.literal('')),
  phone: z.string().max(50).optional().or(z.literal('')),
  location: z.string().max(200).optional().or(z.literal('')),
  headline: z.string().optional().or(z.literal('')),
  status: z.enum(['target', 'requested', 'connected', 'engaged', 'relationship']),
  seniority: z.enum(['ic', 'manager', 'director', 'vp', 'c_suite', '']),
  notes: z.string().optional().or(z.literal('')),
  introductionSource: z.string().max(200).optional().or(z.literal('')),
  mutualConnectionsCount: z.coerce.number().int().min(0).optional(),
  isActiveOnLinkedin: z.boolean(),
  hasOpenToConnect: z.boolean(),
});

export type ContactFormData = z.infer<typeof contactFormSchema>;

const SENIORITY_LABELS: Record<string, string> = {
  ic: 'Individual Contributor',
  manager: 'Manager',
  director: 'Director',
  vp: 'VP',
  c_suite: 'C-Suite',
};

interface ContactFormProps {
  contact?: Contact;
  onSubmit: (_data: ContactFormData, _categoryIds: string[], _tagNames: string[]) => Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
}

export default function ContactForm({
  contact,
  onSubmit,
  onCancel,
  isSubmitting,
}: ContactFormProps) {
  const { data: catData } = useCategories();
  const { data: tagData } = useTags();
  const categories = catData?.data ?? [];
  const allTags = tagData?.data ?? [];

  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      firstName: contact?.firstName ?? '',
      lastName: contact?.lastName ?? '',
      title: contact?.title ?? '',
      company: contact?.company ?? '',
      linkedinUrl: contact?.linkedinUrl ?? '',
      email: contact?.email ?? '',
      phone: contact?.phone ?? '',
      location: contact?.location ?? '',
      headline: contact?.headline ?? '',
      status: contact?.status ?? 'target',
      seniority: (contact?.seniority ?? '') as ContactFormData['seniority'],
      notes: contact?.notes ?? '',
      introductionSource: contact?.introductionSource ?? '',
      mutualConnectionsCount: contact?.mutualConnectionsCount ?? 0,
      isActiveOnLinkedin: contact?.isActiveOnLinkedin ?? false,
      hasOpenToConnect: contact?.hasOpenToConnect ?? false,
    },
  });

  // Initialize categories and tags from existing contact
  useEffect(() => {
    if (contact) {
      setSelectedCategories(contact.categories.map((cc) => cc.categoryId));
      setSelectedTags(contact.tags.map((ct) => ct.tag.name));
    }
  }, [contact]);

  const toggleCategory = (id: string) => {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const addTag = (name: string) => {
    const trimmed = name.trim();
    if (trimmed && !selectedTags.includes(trimmed)) {
      setSelectedTags((prev) => [...prev, trimmed]);
    }
    setTagInput('');
    setShowTagSuggestions(false);
  };

  const removeTag = (name: string) => {
    setSelectedTags((prev) => prev.filter((t) => t !== name));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (tagInput.trim()) {
        addTag(tagInput);
      }
    }
  };

  const filteredTagSuggestions = allTags.filter(
    (t) => t.name.toLowerCase().includes(tagInput.toLowerCase()) && !selectedTags.includes(t.name)
  );

  const doSubmit = async (data: ContactFormData) => {
    await onSubmit(data, selectedCategories, selectedTags);
  };

  return (
    <form
      onSubmit={handleSubmit(doSubmit as Parameters<typeof handleSubmit>[0])}
      className="space-y-6"
    >
      {/* Name section */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Basic Information
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="First Name" error={errors.firstName?.message} required>
            <input
              {...register('firstName')}
              className={inputClass(!!errors.firstName)}
              placeholder="John"
            />
          </Field>
          <Field label="Last Name" error={errors.lastName?.message} required>
            <input
              {...register('lastName')}
              className={inputClass(!!errors.lastName)}
              placeholder="Doe"
            />
          </Field>
          <Field label="Headline" error={errors.headline?.message}>
            <input
              {...register('headline')}
              className={inputClass(false)}
              placeholder="CEO at Acme Corp"
            />
          </Field>
          <Field label="Company" error={errors.company?.message}>
            <input {...register('company')} className={inputClass(false)} placeholder="Acme Corp" />
          </Field>
          <Field label="Title" error={errors.title?.message}>
            <input
              {...register('title')}
              className={inputClass(false)}
              placeholder="Chief Executive Officer"
            />
          </Field>
          <Field label="Seniority" error={errors.seniority?.message}>
            <select {...register('seniority')} className={inputClass(false)}>
              <option value="">Select...</option>
              {Object.entries(SENIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {/* Contact info section */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Contact Details
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Email" error={errors.email?.message}>
            <input
              {...register('email')}
              type="email"
              className={inputClass(!!errors.email)}
              placeholder="john@example.com"
            />
          </Field>
          <Field label="Phone" error={errors.phone?.message}>
            <input {...register('phone')} className={inputClass(false)} placeholder="+1 555 0100" />
          </Field>
          <Field label="Location" error={errors.location?.message}>
            <input
              {...register('location')}
              className={inputClass(false)}
              placeholder="San Francisco, CA"
            />
          </Field>
          <Field label="LinkedIn URL" error={errors.linkedinUrl?.message}>
            <input
              {...register('linkedinUrl')}
              className={inputClass(false)}
              placeholder="https://linkedin.com/in/johndoe"
            />
          </Field>
          <Field label="Introduction Source" error={errors.introductionSource?.message}>
            <input
              {...register('introductionSource')}
              className={inputClass(false)}
              placeholder="Mutual connection, event, etc."
            />
          </Field>
          <Field label="Mutual Connections">
            <input
              {...register('mutualConnectionsCount')}
              type="number"
              min={0}
              className={inputClass(false)}
            />
          </Field>
        </div>
      </div>

      {/* Status and signals */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Status & Signals
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Status" error={errors.status?.message}>
            <select {...register('status')} className={inputClass(false)}>
              <option value="target">Target</option>
              <option value="requested">Requested</option>
              <option value="connected">Connected</option>
              <option value="engaged">Engaged</option>
              <option value="relationship">Relationship</option>
            </select>
          </Field>
          <div className="flex items-center gap-6 pt-6">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                {...register('isActiveOnLinkedin')}
                type="checkbox"
                className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
              />
              Active on LinkedIn
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                {...register('hasOpenToConnect')}
                type="checkbox"
                className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
              />
              Open to Connect
            </label>
          </div>
        </div>
      </div>

      {/* Categories */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Categories</h2>
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => toggleCategory(cat.id)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                selectedCategories.includes(cat.id)
                  ? 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700'
                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100 dark:bg-slate-800 dark:text-gray-400 dark:border-slate-600 dark:hover:bg-slate-700'
              }`}
            >
              {cat.name}
            </button>
          ))}
          {categories.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">No categories available.</p>
          )}
        </div>
      </div>

      {/* Tags */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Tags</h2>
        <div className="flex flex-wrap gap-2 mb-3">
          {selectedTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-gray-300"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </span>
          ))}
        </div>
        <div className="relative">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => {
              setTagInput(e.target.value);
              setShowTagSuggestions(e.target.value.length > 0);
            }}
            onKeyDown={handleTagKeyDown}
            onBlur={() => setTimeout(() => setShowTagSuggestions(false), 200)}
            onFocus={() => {
              if (tagInput.length > 0) setShowTagSuggestions(true);
            }}
            className={inputClass(false)}
            placeholder="Type tag name and press Enter..."
          />
          {showTagSuggestions && filteredTagSuggestions.length > 0 && (
            <div className="absolute top-full mt-1 left-0 right-0 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
              {filteredTagSuggestions.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => addTag(tag.name)}
                  className="block w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                >
                  {tag.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Notes */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Notes</h2>
        <textarea
          {...register('notes')}
          rows={4}
          className={`${inputClass(false)} resize-y`}
          placeholder="Any additional notes about this contact..."
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Saving...' : contact ? 'Update Contact' : 'Create Contact'}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function inputClass(hasError: boolean): string {
  return `w-full rounded-lg border ${
    hasError
      ? 'border-red-300 dark:border-red-600 focus:ring-red-500 focus:border-red-500'
      : 'border-gray-300 dark:border-slate-600 focus:ring-primary-500 focus:border-primary-500'
  } bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2`;
}
