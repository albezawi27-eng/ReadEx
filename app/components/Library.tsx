'use client';

import React, { useEffect, useRef, useState } from 'react';
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
  onUploadNewBook: (file: File) => void;
  onDeleteBook: (bookId: string) => void;
  isProcessing: boolean;
  refreshKey: number;
}

function progressColor(pct: number): string {
  if (pct >= 100) return 'bg-green-500';
  if (pct >= 33) return 'bg-amber-500';
  return 'bg-red-400';
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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

    onUploadNewBook(file);
    e.target.value = '';
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
      setToolsMessage('');
    } catch (err) {
      console.error('Flashcard export failed:', err);
      setToolsMessage(err instanceof Error ? err.message : 'Flashcard export failed.');
    } finally {
      setToolsBusy(null);
    }
  };

  return (
    <div className={`w-full h-screen ${themeClasses.bg} ${themeClasses.text} flex flex-col overflow-y-auto`}>
      <div className="max-w-4xl w-full mx-auto px-8 py-12">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-4">
          <h1 className="text-3xl sm:text-4xl font-bold">My Library</h1>
          <label
            className={`px-5 py-3 rounded-lg font-medium cursor-pointer transition ${themeClasses.button} ${
              isProcessing ? 'opacity-60 pointer-events-none' : ''
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={handleFileChange}
              disabled={isProcessing}
            />
            {isProcessing ? '⏳ Processing...' : '📄 Upload New Book'}
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-8">
          <button
            onClick={handleExportLibrary}
            disabled={toolsBusy !== null}
            className={`text-xs px-3 py-2 rounded-lg border ${themeClasses.border} border-opacity-30 ${themeClasses.hover} disabled:opacity-50`}
            title="Download everything: books, progress, notes, annotations, AI chats"
          >
            {toolsBusy === 'export' ? '⏳ Exporting...' : '💾 Export Library'}
          </button>
          <button
            onClick={() => backupInputRef.current?.click()}
            disabled={toolsBusy !== null}
            className={`text-xs px-3 py-2 rounded-lg border ${themeClasses.border} border-opacity-30 ${themeClasses.hover} disabled:opacity-50`}
            title="Restore from a previously exported backup"
          >
            {toolsBusy === 'import' ? '⏳ Importing...' : '📥 Import Library'}
          </button>
          <input
            ref={backupInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={handleImportFileSelected}
          />
          <button
            onClick={handleExportFlashcards}
            disabled={toolsBusy !== null}
            className={`text-xs px-3 py-2 rounded-lg border ${themeClasses.border} border-opacity-30 ${themeClasses.hover} disabled:opacity-50`}
            title="Export all notes as Anki-importable flashcards"
          >
            {toolsBusy === 'flashcards' ? '⏳ Exporting...' : '🗂️ Export Flashcards'}
          </button>
        </div>

        {toolsMessage && <div className="mb-6 text-sm opacity-70">{toolsMessage}</div>}

        {uploadError && (
          <div className="mb-6 p-3 bg-opacity-20 bg-red-500 rounded text-sm text-red-700 dark:text-red-300">
            ⚠️ {uploadError}
          </div>
        )}

        {isLoading ? (
          <p className="opacity-60">Loading your library...</p>
        ) : entries.length === 0 ? (
          <div className="text-center py-20 opacity-60">
            <p className="text-lg">No books yet.</p>
            <p className="text-sm mt-2">Upload a PDF to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {entries.map((entry) => {
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
                  className={`relative text-left p-5 rounded-xl border ${themeClasses.border} border-opacity-20 ${themeClasses.hover} transition cursor-pointer`}
                >
                  <button
                    onClick={(e) => handleDeleteClick(e, entry.id)}
                    className={`absolute top-3 right-3 text-xs px-2 py-1 rounded-full transition ${
                      isConfirmingDelete
                        ? 'bg-red-500 text-white'
                        : 'opacity-40 hover:opacity-100 hover:bg-red-500 hover:text-white'
                    }`}
                    title={isConfirmingDelete ? 'Click again to confirm' : 'Delete book'}
                  >
                    {isConfirmingDelete ? 'Confirm delete?' : '🗑️'}
                  </button>

                  <h3 className="font-semibold truncate mb-2 pr-16">{entry.title}</h3>
                  <p className="text-xs opacity-50 mb-3">
                    Added {new Date(entry.uploadedAt).toLocaleDateString()}
                  </p>
                  <div className="w-full h-2 rounded-full bg-current bg-opacity-10 overflow-hidden">
                    <div className={`h-full transition-all ${progressColor(pct)}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs opacity-50 mt-2">
                    {entry.completedCount} / {entry.totalSections} sections · {pct}%
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}