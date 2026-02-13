'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table';
import type { Contact } from '@/lib/types';
import StatusBadge from './StatusBadge';
import ScoreBadge from './ScoreBadge';

const columnHelper = createColumnHelper<Contact>();

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const columns = [
  columnHelper.display({
    id: 'select',
    header: ({ table }) => (
      <input
        type="checkbox"
        checked={table.getIsAllPageRowsSelected()}
        onChange={table.getToggleAllPageRowsSelectedHandler()}
        className="rounded border-gray-300 dark:border-gray-600"
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        checked={row.getIsSelected()}
        onChange={row.getToggleSelectedHandler()}
        className="rounded border-gray-300 dark:border-gray-600"
        onClick={(e) => e.stopPropagation()}
      />
    ),
    size: 40,
  }),
  columnHelper.accessor((row) => `${row.firstName} ${row.lastName}`, {
    id: 'name',
    header: 'Name',
    cell: (info) => (
      <div>
        <div className="font-medium text-gray-900 dark:text-white">{info.getValue()}</div>
        {info.row.original.headline && (
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
            {info.row.original.headline}
          </div>
        )}
      </div>
    ),
  }),
  columnHelper.accessor('company', {
    header: 'Company',
    cell: (info) => (
      <span className="text-gray-700 dark:text-gray-300">{info.getValue() || '-'}</span>
    ),
  }),
  columnHelper.accessor('title', {
    header: 'Title',
    cell: (info) => (
      <span className="text-gray-600 dark:text-gray-400 text-sm truncate max-w-[150px] block">
        {info.getValue() || '-'}
      </span>
    ),
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: (info) => <StatusBadge status={info.getValue()} />,
  }),
  columnHelper.accessor('relationshipScore', {
    header: 'Score',
    cell: (info) => <ScoreBadge score={info.getValue()} />,
  }),
  columnHelper.accessor('lastInteractionAt', {
    header: 'Last Interaction',
    cell: (info) => (
      <span className="text-sm text-gray-500 dark:text-gray-400">
        {formatDate(info.getValue())}
      </span>
    ),
  }),
];

interface ContactTableProps {
  contacts: Contact[];
  rowSelection: RowSelectionState;
  onRowSelectionChange: React.Dispatch<React.SetStateAction<RowSelectionState>>;
  sorting: SortingState;
  onSortingChange: React.Dispatch<React.SetStateAction<SortingState>>;
}

export default function ContactTable({
  contacts,
  rowSelection,
  onRowSelectionChange,
  sorting,
  onSortingChange,
}: ContactTableProps) {
  const router = useRouter();

  const table = useReactTable({
    data: contacts,
    columns,
    state: { rowSelection, sorting },
    onRowSelectionChange,
    onSortingChange,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    getRowId: (row) => row.id,
    enableRowSelection: true,
  });

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
        <thead className="bg-gray-50 dark:bg-slate-800">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none"
                  style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                  onClick={
                    header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined
                  }
                >
                  <div className="flex items-center gap-1">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getIsSorted() === 'asc' && (
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M5.293 9.707l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L10 7.414l-3.293 3.293a1 1 0 01-1.414-1.414z" />
                      </svg>
                    )}
                    {header.column.getIsSorted() === 'desc' && (
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M14.707 10.293l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L10 12.586l3.293-3.293a1 1 0 111.414 1.414z" />
                      </svg>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="bg-white dark:bg-slate-900 divide-y divide-gray-100 dark:divide-slate-800">
          {table.getRowModel().rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-12 text-center text-gray-500 dark:text-gray-400"
              >
                No contacts found
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                onClick={() => router.push(`/contacts/${row.original.id}`)}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3 whitespace-nowrap text-sm">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
