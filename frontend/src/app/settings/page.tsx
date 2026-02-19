'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSettings, useUpdateSettings } from '@/hooks/useSettings';

interface SettingsForm {
  queue_generation_time: string;
  linkedin_weekly_limit: string;
  linkedin_daily_limit: string;
  cooldown_days: string;
  guided_mode: string;
  notification_morning: string;
  notification_afternoon: string;
  network_goal: string;
}

const DEFAULTS: SettingsForm = {
  queue_generation_time: '07:00',
  linkedin_weekly_limit: '100',
  linkedin_daily_limit: '20',
  cooldown_days: '7',
  guided_mode: 'true',
  notification_morning: 'true',
  notification_afternoon: 'true',
  network_goal: '7000',
};

export default function SettingsPage() {
  const { data: settingsData, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();

  const [form, setForm] = useState<SettingsForm>(DEFAULTS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settingsData?.data) {
      setForm((prev) => ({ ...prev, ...settingsData.data }));
    }
  }, [settingsData?.data]);

  const handleSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSaved(false);
      await updateSettings.mutateAsync({ ...form });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
    [form, updateSettings]
  );

  const setField = useCallback((key: keyof SettingsForm, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Settings</h1>

      <form onSubmit={handleSave} className="space-y-8">
        {/* Queue Generation */}
        <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
            Queue Generation
          </h2>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
              Generation Time
            </label>
            <div className="flex items-center gap-3">
              <input
                type="time"
                value={form.queue_generation_time}
                onChange={(e) => setField('queue_generation_time', e.target.value)}
                className="w-36 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Mexico City time
              </span>
            </div>
          </div>
        </section>

        {/* Rate Limits */}
        <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
            Rate Limits
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                Weekly Limit
              </label>
              <input
                type="number"
                min={1}
                max={500}
                value={form.linkedin_weekly_limit}
                onChange={(e) => setField('linkedin_weekly_limit', e.target.value)}
                className="w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Maximum connection requests per week (recommended: 100)
              </p>
            </div>
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                Daily Limit
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={form.linkedin_daily_limit}
                onChange={(e) => setField('linkedin_daily_limit', e.target.value)}
                className="w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Maximum connection requests per day (recommended: 20)
              </p>
            </div>
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                Cooldown Duration (days)
              </label>
              <input
                type="number"
                min={1}
                max={30}
                value={form.cooldown_days}
                onChange={(e) => setField('cooldown_days', e.target.value)}
                className="w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Days to pause after detecting a soft ban signal
              </p>
            </div>
          </div>
        </section>

        {/* Guided Mode */}
        <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
            Queue Mode
          </h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">Guided Mode</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Show step-by-step LinkedIn instructions in the queue
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={form.guided_mode === 'true'}
                onChange={(e) => setField('guided_mode', e.target.checked ? 'true' : 'false')}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:after:border-gray-600 peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </section>

        {/* Notifications */}
        <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
            Notifications
          </h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-700 dark:text-gray-300">Morning Queue Ready</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Notify when the daily queue is generated
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.notification_morning === 'true'}
                  onChange={(e) =>
                    setField('notification_morning', e.target.checked ? 'true' : 'false')
                  }
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:after:border-gray-600 peer-checked:bg-blue-600"></div>
              </label>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-700 dark:text-gray-300">Afternoon Overdue</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Remind if queue items are still pending in the afternoon
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.notification_afternoon === 'true'}
                  onChange={(e) =>
                    setField('notification_afternoon', e.target.checked ? 'true' : 'false')
                  }
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:after:border-gray-600 peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </div>
        </section>

        {/* Network Goal */}
        <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
            Network Goal
          </h2>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
              Target Network Size
            </label>
            <input
              type="number"
              min={1}
              value={form.network_goal}
              onChange={(e) => setField('network_goal', e.target.value)}
              className="w-40 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Used for the dashboard progress bar
            </p>
          </div>
        </section>

        {/* Save Button */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={updateSettings.isPending}
            className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {updateSettings.isPending ? 'Saving...' : 'Save Settings'}
          </button>
          {saved && (
            <span className="text-sm text-green-600 dark:text-green-400">
              Settings saved successfully!
            </span>
          )}
          {updateSettings.isError && (
            <span className="text-sm text-red-600 dark:text-red-400">
              Failed to save. Please check values and try again.
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
