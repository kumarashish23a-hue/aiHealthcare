'use client';

import { Moon, Sun } from 'lucide-react';

const STORAGE_KEY = 'swasthya-theme';

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const toggle = () => {
    const root = document.documentElement;
    const next = !root.classList.contains('dark');
    root.classList.add('theming');
    root.classList.toggle('dark', next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      // Private browsing: theme simply won't persist
    }
    window.setTimeout(() => root.classList.remove('theming'), 300);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
      className={`${className} min-h-[36px] min-w-[36px] px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 flex items-center justify-center shrink-0`}
    >
      <Moon className="w-4 h-4 dark:hidden" aria-hidden="true" />
      <Sun className="w-4 h-4 hidden dark:block" aria-hidden="true" />
    </button>
  );
}
