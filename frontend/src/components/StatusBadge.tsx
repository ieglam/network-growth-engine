import type { ContactStatus } from '@nge/shared';

const STATUS_CONFIG: Record<ContactStatus, { label: string; className: string }> = {
  target: {
    label: 'Target',
    className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
  requested: {
    label: 'Requested',
    className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  },
  connected: {
    label: 'Connected',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  },
  engaged: {
    label: 'Engaged',
    className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  },
  relationship: {
    label: 'Relationship',
    className: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  },
};

export default function StatusBadge({ status }: { status: ContactStatus }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.target;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}
