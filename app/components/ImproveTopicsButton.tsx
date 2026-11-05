'use client';

import React, { useState } from 'react';
import { useTheme, getThemeClasses } from '@/app/context/ThemeContext';

export default function ImproveTopicsButton({ onImprove }: { onImprove: () => Promise<string | null> }) {
  const { theme } = useTheme();
  const themeClasses = getThemeClasses(theme);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const error = await onImprove();
      setMessage(error ? { kind: 'error', text: error } : { kind: 'ok', text: 'Topics updated.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 px-1">
      <button
        onClick={run}
        disabled={busy}
        className={`w-full py-1.5 text-xs rounded-lg font-semibold border ${themeClasses.border} ${themeClasses.hover} transition disabled:opacity-60`}
        title="Rebuild this book's topics using Gemini"
      >
        {busy ? '⏳ Reading the book…' : '✨ Improve topics with AI'}
      </button>
      <p className="text-[11px] opacity-60 mt-1.5">
        Uses your Gemini key and sends this PDF to Google. Runs once per book.
      </p>
      {message && (
        <p className={`text-[11px] mt-1.5 ${message.kind === 'error' ? 'text-red-500' : 'text-emerald-600'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}