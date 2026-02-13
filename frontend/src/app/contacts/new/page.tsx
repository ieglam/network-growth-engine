'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import ContactForm, { type ContactFormData } from '@/components/ContactForm';
import { useCreateContact } from '@/hooks/useContacts';

export default function NewContactPage() {
  const router = useRouter();
  const createContact = useCreateContact();

  const handleSubmit = async (data: ContactFormData, categoryIds: string[], tagNames: string[]) => {
    const result = await createContact.mutateAsync({
      contact: {
        ...data,
        seniority: data.seniority || undefined,
      },
      categoryIds,
      tagNames,
    });
    router.push(`/contacts/${result.data.id}`);
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <button
          onClick={() => router.push('/contacts')}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to Contacts
        </button>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-2">New Contact</h1>
      </div>
      <ContactForm
        onSubmit={handleSubmit}
        onCancel={() => router.push('/contacts')}
        isSubmitting={createContact.isPending}
      />
    </div>
  );
}
