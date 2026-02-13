'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import ContactForm, { type ContactFormData } from '@/components/ContactForm';
import { useContact, useUpdateContact } from '@/hooks/useContacts';

export default function EditContactPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { data, isLoading, error } = useContact(id);
  const updateContact = useUpdateContact();

  const handleSubmit = async (
    formData: ContactFormData,
    categoryIds: string[],
    tagNames: string[]
  ) => {
    await updateContact.mutateAsync({
      contactId: id,
      contact: {
        ...formData,
        seniority: formData.seniority || undefined,
      },
      categoryIds,
      tagNames,
    });
    router.push(`/contacts/${id}`);
  };

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

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <button
          onClick={() => router.push(`/contacts/${id}`)}
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
          Back to Contact
        </button>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-2">Edit Contact</h1>
      </div>
      <ContactForm
        contact={data.data}
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/contacts/${id}`)}
        isSubmitting={updateContact.isPending}
      />
    </div>
  );
}
