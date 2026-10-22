'use client';

import React, { useEffect, useState } from 'react';
import { useTheme, getThemeClasses } from '@/app/context/ThemeContext';
import { getAllBooks, getProgress, StoredBook } from '@/app/utils/db';
import { exportLibrary, importLibrary } from '@/app/utils/backup';
import { exportNotesAsFlashcardPdf } from '@/app/utils/flashcards';
import { downloadBlob } from '@/app/utils/pdfExport';

interface LibraryEntry extends StoredBook {
  completedCount: number;
  totalSections: number;
}

interface LibraryProps {
  onOpenBook: (bookId: string) => void;
  onUploadNewBook: (file: File) => Promise<void>;
  onDeleteBook: (bookId: string) => void;
  isProcessing: boolean;
  refreshKey: number;
}

const FEATURES = [
  { icon: '🧭', title: 'Page-by-page reading', desc: 'Jump between pages from the sidebar and track what you have finished.' },
  { icon: '✏️', title: 'Draw & annotate', desc: 'Mark up pages with colors and text, with full undo and redo.' },
  { icon: '💬', title: 'Ask AI', desc: 'Chat with Gemini about the whole document, right where you read.' },
  { icon: '📤', title: 'Export anywhere', desc: 'Download your annotated PDF or turn your notes into flashcards.' },
];

const COVER_GRADIENTS = [
  'from-indigo-500 to-violet-500',
  'from-sky-500 to-indigo-500',
  'from-emerald-500 to-teal-500',
  'from-rose-500 to-orange-400',
  'from-fuchsia-500 to-purple-500',
  'from-amber-500 to-orange-500',
];

function coverGradient(id: string): string {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return COVER_GRADIENTS[sum % COVER_GRADIENTS.length];
}

function progressColor(pct: number): string {
  if (pct >= 100) return 'bg-emerald-500';
  if (pct >= 33) return 'bg-amber-500';
  return 'bg-rose-400';
}

export default function Library({
  onOpenBook,
  onUploadNewBook,
  onDeleteBook,
  isProcessing,
  refreshKey,
}: LibraryProps) {
  const { theme } = useTheme();
  const themeClasses = getThemeClasses(theme);
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploadError, setUploadError] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [toolsBusy, setToolsBusy] = useState<'export' | 'import' | 'flashcards' | null>(null);
  const [toolsMessage, setToolsMessage] = useState('');
  const [localRefreshKey, setLocalRefreshKey] = useState(0);

  const heroGradient =
    theme === 'dark'
      ? 'bg-gradient-to-b from-[#1a1d2e] via-[#0e1015] to-[#0e1015]'
      : theme === 'colorful'
        ? 'bg-gradient-to-b from-orange-100 via-amber-50 to-amber-50'
        : 'bg-gradient-to-b from-indigo-50 via-slate-50 to-slate-50';

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      const books = await getAllBooks();
      const withProgress = await Promise.all(
        books.map(async (book) => {
          const progress = await getProgress(book.id);
          return {
            ...book,
            completedCount: progress?.completedSectionKeys.length ?? 0,
            totalSections: progress?.totalSections ?? 0,
          };
        })
      );
      if (!cancelled) {
        setEntries(withProgress);
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshKey, localRefreshKey]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setUploadError('');
    if (!file) return;

    if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
      setUploadError('Please upload a PDF file');
      return;
    }

    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      setUploadError('File size exceeds 50MB limit');
      return;
    }

    try {
      await onUploadNewBook(file);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload this book.');
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, bookId: string) => {
    e.stopPropagation();
    if (pendingDeleteId === bookId) {
      onDeleteBook(bookId);
      setPendingDeleteId(null);
    } else {
      setPendingDeleteId(bookId);
    }
  };

  const handleExportLibrary = async () => {
    setToolsBusy('export');
    setToolsMessage('');
    try {
      const blob = await exportLibrary();
      const date = new Date().toISOString().split('T')[0];
      downloadBlob(blob, `readex-backup-${date}.zip`);
    } catch (err) {
      console.error('Library export failed:', err);
      setToolsMessage('Export failed -- check the console for details.');
    } finally {
      setToolsBusy(null);
    }
  };

  const handleImportFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setToolsBusy('import');
    setToolsMessage('');
    try {
      const result = await importLibrary(file);
      setToolsMessage(`Imported ${result.booksImported} book(s).`);
      setLocalRefreshKey((k) => k + 1);
    } catch (err) {
      console.error('Library import failed:', err);
      setToolsMessage(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setToolsBusy(null);
    }
  };

  const handleExportFlashcards = async () => {
    setToolsBusy('flashcards');
    setToolsMessage('');
    try {
      const blob = await exportNotesAsFlashcardPdf();
      downloadBlob(blob, 'readex-flashcards.pdf');
    } catch (err) {
      console.error('Flashcard export failed:', err);
      setToolsMessage(err instanceof Error ? err.message : 'Flashcard export failed.');
    } finally {
      setToolsBusy(null);
    }
  };

  const toolButtonClass = `text-xs font-medium px-3 py-2 rounded-lg border ${themeClasses.border} ${themeClasses.card} ${themeClasses.hover} transition disabled:opacity-50`;

  return (
    <div className={`w-full h-screen ${heroGradient} ${themeClasses.text} flex flex-col overflow-y-auto`}>
      {/* Hidden inputs shared by the buttons below */}
      <input
        id="library-upload-input"
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={handleFileChange}
        disabled={isProcessing}
      />
      <input
        id="library-import-input"
        type="file"
        accept=".zip"
        className="hidden"
        onChange={handleImportFileSelected}
      />

      <div className="max-w-5xl w-full mx-auto px-6 md:px-8 pt-12 pb-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-3xl shadow-lg shadow-indigo-500/30">
            📖
          </div>
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-500 to-violet-500 bg-clip-text text-transparent">
              ReadEx
            </h1>
            <p className={`text-sm mt-0.5 ${themeClasses.muted}`}>
              Read, annotate, and understand your PDFs — with AI built in.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl w-full mx-auto px-6 md:px-8 pb-12 flex-1">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold">My Library</h2>
          <label
            htmlFor="library-upload-input"
            className={`px-5 py-2.5 rounded-xl text-sm font-semibold cursor-pointer text-center transition ${
              themeClasses.button
            } ${isProcessing ? 'opacity-60 pointer-events-none' : ''}`}
          >
            {isProcessing ? '⏳ Processing…' : '＋ Add a book'}
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-6">
          <button onClick={handleExportLibrary} disabled={toolsBusy !== null} className={toolButtonClass}>
            {toolsBusy === 'export' ? '⏳ Exporting…' : '💾 Backup library'}
          </button>
          <label htmlFor="library-import-input" className={`${toolButtonClass} cursor-pointer`}>
            {toolsBusy === 'import' ? '⏳ Importing…' : '📥 Restore backup'}
          </label>
          <button onClick={handleExportFlashcards} disabled={toolsBusy !== null} className={toolButtonClass}>
            {toolsBusy === 'flashcards' ? '⏳ Exporting…' : '🗂️ Flashcards PDF'}
          </button>
        </div>

        {toolsMessage && <div className={`mb-5 text-sm ${themeClasses.muted}`}>{toolsMessage}</div>}

        {uploadError && (
          <div className="mb-5 p-3 rounded-xl text-sm bg-red-500/10 text-red-600 dark:text-red-300 border border-red-500/20">
            ⚠️ {uploadError}
          </div>
        )}

        {isLoading ? (
          <p className={themeClasses.muted}>Loading your library…</p>
        ) : entries.length === 0 ? (
          <div>
            <label
              htmlFor="library-upload-input"
              className={`block text-center rounded-2xl border-2 border-dashed ${themeClasses.border} ${themeClasses.card} px-6 py-12 cursor-pointer ${themeClasses.hover} transition mb-8`}
            >
              <div className="text-4xl mb-3">📄</div>
              <p className="font-semibold">Add your first PDF</p>
              <p className={`text-sm mt-1 ${themeClasses.muted}`}>Click to choose a file — it stays on this device.</p>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {FEATURES.map((f, i) => (
                <div
                  key={f.title}
                  style={{ animationDelay: `${i * 70}ms` }}
                  className={`fade-up p-5 rounded-2xl border ${themeClasses.border} ${themeClasses.card}`}
                >
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-xl mb-3">
                    {f.icon}
                  </div>
                  <h3 className="font-semibold mb-1">{f.title}</h3>
                  <p className={`text-sm ${themeClasses.muted}`}>{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {entries.map((entry, i) => {
              const pct =
                entry.totalSections > 0
                  ? Math.round((entry.completedCount / entry.totalSections) * 100)
                  : 0;
              const isConfirmingDelete = pendingDeleteId === entry.id;

              return (
                <div
                  key={entry.id}
                  onClick={() => onOpenBook(entry.id)}
                  onMouseLeave={() => isConfirmingDelete && setPendingDeleteId(null)}
                  style={{ animationDelay: `${i * 60}ms` }}
                  className={`fade-up group relative rounded-2xl border ${themeClasses.border} ${themeClasses.card} overflow-hidden cursor-pointer transition hover:-translate-y-0.5 hover:shadow-xl`}
                >
                  <div
                    className={`h-24 bg-gradient-to-br ${coverGradient(
                      entry.id
                    )} flex items-center justify-center text-4xl`}
                  >
                    📘
                  </div>

                  <button
                    onClick={(e) => handleDeleteClick(e, entry.id)}
                    className={`absolute top-2 right-2 text-xs px-2 py-1 rounded-full transition ${
                      isConfirmingDelete
                        ? 'bg-red-500 text-white'
                        : 'bg-black/25 text-white opacity-0 group-hover:opacity-100 hover:bg-red-500'
                    }`}
                    title={isConfirmingDelete ? 'Click again to confirm' : 'Delete book'}
                  >
                    {isConfirmingDelete ? 'Confirm delete?' : '🗑️'}
                  </button>

                  <div className="p-4">
                    <h3 className="font-semibold truncate mb-1">{entry.title}</h3>
                    <p className={`text-xs mb-3 ${themeClasses.muted}`}>
                      Added {new Date(entry.uploadedAt).toLocaleDateString()}
                    </p>
                    <div className="h-1.5 rounded-full bg-current/10 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${progressColor(pct)}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className={`text-xs mt-2 ${themeClasses.muted}`}>
                      {entry.completedCount} / {entry.totalSections} pages · {pct}%
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}