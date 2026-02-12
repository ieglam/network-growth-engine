'use client';

import { useEffect, useState } from 'react';

interface HealthStatus {
  status: string;
  timestamp: string;
  uptime: number;
  version: string;
}

export default function Home() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkHealth() {
      try {
        const response = await fetch('http://localhost:3001/api/health');
        const data = await response.json();
        if (data.success) {
          setHealth(data.data);
        } else {
          setError('Backend returned error');
        }
      } catch {
        setError('Cannot connect to backend');
      } finally {
        setLoading(false);
      }
    }

    checkHealth();
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="max-w-2xl w-full">
        <h1 className="text-4xl font-bold text-center mb-8">Network Growth Engine</h1>

        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">System Status</h2>

          {loading && (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          )}

          {error && (
            <div className="bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-100 p-4 rounded-lg">
              <p className="font-medium">Backend Unavailable</p>
              <p className="text-sm">{error}</p>
              <p className="text-sm mt-2">
                Make sure to run:{' '}
                <code className="bg-red-200 dark:bg-red-800 px-1 rounded">npm run dev</code>
              </p>
            </div>
          )}

          {health && (
            <div className="bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-100 p-4 rounded-lg">
              <p className="font-medium">Backend Connected</p>
              <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
                <span>Status:</span>
                <span className="font-mono">{health.status}</span>
                <span>Version:</span>
                <span className="font-mono">{health.version}</span>
                <span>Uptime:</span>
                <span className="font-mono">{Math.round(health.uptime)}s</span>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Quick Links</h2>
          <p className="text-gray-600 dark:text-gray-300 mb-4">
            UI components coming in Phase 1...
          </p>
          <ul className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
            <li>Dashboard - TASK-026</li>
            <li>Contacts - TASK-019</li>
            <li>Queue - TASK-023</li>
            <li>Templates - TASK-024</li>
            <li>Settings - TASK-027</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
