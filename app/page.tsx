'use client';

import { useEffect, useRef, useState } from 'react';
import { ThemeProvider, useTheme, getThemeClasses } from '@/app/context/ThemeContext';
import Sidebar from '@/app/components/Sidebar';
import ContentPanel from '@/app/components/ContentPanel';
import Library from '@/app/components/Library';
import { extractPDFText, PDFSection, PageCrop } from '@/app/utils/pdfParser';
import {
  generateBookId,
  saveBook,
  saveProgress,
  getProgress,
  saveNote,
  getNotesForBook,
  getBook,
  deleteBook,
  makeSectionKey,
  StoredProgress,
  StoredNote,
} from '@/app/utils/db';

interface AppSection {
  id: string;
  title: string;
  content: string;
  crops?: PageCrop[];
}

function HomeContent() {
  const { theme } = useTheme();
  const themeClasses = getThemeClasses(theme);

  const [view, setView] = useState<'library' | 'reader'>('library');
  const [isProcessing, setIsProcessing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [allSections, setAllSections] = useState<AppSection[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [highlightedLines, setHighlightedLines] = useState<Set<number>>(new Set());
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [mobileShowSidebar, setMobileShowSidebar] = useState(true);

  const noteSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (navigator.storage?.persist) {
      navigator.storage.persist();
    }
  }, []);

  const currentSection = allSections.find((s) => s.id === activeSectionId) || null;

  const activateBook = (
    sections: PDFSection[],
    file: File,
    bookId: string,
    storedProgress: StoredProgress | undefined,
    storedNotes: StoredNote[]
  ) => {
    const mapped: AppSection[] = sections.map((pdf, index) => ({
      id: makeSectionKey(bookId, index, pdf.title),
      title: pdf.title,
      content: pdf.content,
      crops: pdf.crops,
    }));

    const notesMap: Record<string, string> = {};
    for (const note of storedNotes) {
      notesMap[note.sectionKey] = note.text;
    }

    const resumeAt =
      (storedProgress?.lastReadSectionKey &&
        mapped.some((s) => s.id === storedProgress.lastReadSectionKey) &&
        storedProgress.lastReadSectionKey) ||
      mapped[0]?.id ||
      null;

    setAllSections(mapped);
    setActiveBookId(bookId);
    setActiveSectionId(resumeAt);
    setProgress(new Set(storedProgress?.completedSectionKeys ?? []));
    setNotes(notesMap);
    setHighlightedLines(new Set());
    setPdfFile(file);
    setMobileShowSidebar(true); // always start on the section list on phone
  };

  const registerNewBook = async (sections: PDFSection[], file: File) => {
    const bookId = generateBookId();
    await saveBook({ id: bookId, title: file.name, fileBlob: file, uploadedAt: Date.now() });
    const initialProgress: StoredProgress = {
      bookId,
      completedSectionKeys: [],
      totalSections: sections.length,
    };
    await saveProgress(initialProgress);
    activateBook(sections, file, bookId, initialProgress, []);
    setView('reader');
    setRefreshKey((k) => k + 1);
  };

  const handlePDFExtracted = async (pdfSections: PDFSection[], file?: File) => {
    if (!file) return;
    setIsProcessing(true);
    try {
      await registerNewBook(pdfSections, file);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLibraryUpload = async (file: File) => {
    setIsProcessing(true);
    try {
      const sections = await extractPDFText(file);
      await registerNewBook(sections, file);
    } catch (err) {
      console.error('Failed to process uploaded PDF:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOpenSavedBook = async (bookId: string) => {
    setIsProcessing(true);
    try {
      const stored = await getBook(bookId);
      if (!stored) return;
      const file = new File([stored.fileBlob], stored.title, { type: 'application/pdf' });
      const [sections, storedProgress, storedNotes] = await Promise.all([
        extractPDFText(file),
        getProgress(bookId),
        getNotesForBook(bookId),
      ]);
      activateBook(sections, file, bookId, storedProgress, storedNotes);
      setView('reader');
    } catch (err) {
      console.error('Failed to open saved book:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteBook = async (bookId: string) => {
    try {
      await deleteBook(bookId);
      if (activeBookId === bookId) {
        setActiveBookId(null);
        setAllSections([]);
        setActiveSectionId(null);
        setPdfFile(null);
        setView('library');
      }
      setRefreshKey((k) => k + 1);
    } catch (err) {
      console.error('Failed to delete book:', err);
    }
  };

  const handleBackToLibrary = () => {
    setView('library');
    setActiveBookId(null);
    setPdfFile(null);
    setRefreshKey((k) => k + 1);
  };

  const handleSectionSelect = (id: string) => {
    setActiveSectionId(id);
    setHighlightedLines(new Set());
    setMobileShowSidebar(false); // switch to reading view on phone
    if (activeBookId) {
      saveProgress({
        bookId: activeBookId,
        completedSectionKeys: Array.from(progress),
        totalSections: allSections.length,
        lastReadSectionKey: id,
      });
    }
  };

  const handleShowSidebarMobile = () => {
    setMobileShowSidebar(true);
  };

  const handleProgressToggle = (sectionId: string) => {
    setProgress((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      if (activeBookId) {
        saveProgress({
          bookId: activeBookId,
          completedSectionKeys: Array.from(next),
          totalSections: allSections.length,
          lastReadSectionKey: activeSectionId ?? undefined,
        });
      }
      return next;
    });
  };

  const handleLineClick = (lineIndex: number) => {
    const newHighlighted = new Set(highlightedLines);
    if (newHighlighted.has(lineIndex)) {
      newHighlighted.delete(lineIndex);
    } else {
      newHighlighted.add(lineIndex);
    }
    setHighlightedLines(newHighlighted);
  };

  const handleNoteChange = (sectionId: string, text: string) => {
    setNotes((prev) => ({ ...prev, [sectionId]: text }));
    if (!activeBookId) return;

    const existingTimer = noteSaveTimers.current[sectionId];
    if (existingTimer) clearTimeout(existingTimer);

    noteSaveTimers.current[sectionId] = setTimeout(() => {
      saveNote({ sectionKey: sectionId, bookId: activeBookId, text, updatedAt: Date.now() });
    }, 500);
  };

  return (
    <main className={`w-full h-screen ${themeClasses.bg}`}>
      {view === 'library' ? (
        <Library
          onOpenBook={handleOpenSavedBook}
          onUploadNewBook={handleLibraryUpload}
          onDeleteBook={handleDeleteBook}
          isProcessing={isProcessing}
          refreshKey={refreshKey}
        />
      ) : (
        <div className="flex flex-col md:flex-row w-full h-screen">
          <Sidebar
            sections={allSections}
            activeSection={activeSectionId}
            onSectionSelect={handleSectionSelect}
            progress={progress}
            onProgressToggle={handleProgressToggle}
            onPDFExtracted={handlePDFExtracted}
            onBackToLibrary={handleBackToLibrary}
            showOnMobile={mobileShowSidebar}
          />
          <ContentPanel
            activeSection={currentSection}
            highlightedLines={highlightedLines}
            onLineClick={handleLineClick}
            pdfFile={pdfFile}
            noteValue={activeSectionId ? notes[activeSectionId] ?? '' : ''}
            onNoteChange={(text) => activeSectionId && handleNoteChange(activeSectionId, text)}
            showOnMobile={!mobileShowSidebar}
            onShowSidebar={handleShowSidebarMobile}
          />
        </div>
      )}
    </main>
  );
}

export default function Home() {
  return (
    <ThemeProvider>
      <HomeContent />
    </ThemeProvider>
  );
}