'use client';

import React, { useEffect, useState } from 'react';
import { useTheme, getThemeClasses } from '@/app/context/ThemeContext';

export default function ImproveTopicsButton({
  onImprove,
}: {
  onImprove: (onProgress: (stage: string) => void) => Promise<string | null>;
}) {
  const { theme } = useTheme();
  const themeClasses = getThemeClasses(theme);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // A running seconds counter, so it is obvious the app is alive.
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);

  const run = async () => {
    setBusy(true);
    setStage('Starting…');
    setMessage(null);
    try {
      const error = await onImprove(setStage);
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
        {busy ? `⏳ ${stage} (${elapsed}s)` : '✨ Improve topics with AI'}
      </button>
      <p className="text-[11px] opacity-60 mt-1.5">
        Uses your Gemini key. Sends extracted text from this book (not the PDF file) to Google. Runs once per book.
      </p>
      {message && (
        <p className={`text-[11px] mt-1.5 ${message.kind === 'error' ? 'text-red-500' : 'text-emerald-600'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}