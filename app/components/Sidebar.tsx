'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTheme, getThemeClasses, THEME_OPTIONS } from '@/app/context/ThemeContext';
import { extractPDFText, PDFSection } from '@/app/utils/pdfParser';
import { useSoundEnabled } from '@/app/utils/sounds';

interface Section {
  id: string;
  title: string;
  content: string;
}

interface SidebarProps {
  sections: Section[];
  activeSection: string | null;
  onSectionSelect: (id: string) => void;
  progress: Set<string>;
  onProgressToggle: (id: string) => void;
  onPDFExtracted?: (sections: PDFSection[], file?: File) => Promise<void>;
  onBackToLibrary?: () => void;
  showOnMobile: boolean;
}

export default function Sidebar({
  sections,
  activeSection,
  onSectionSelect,
  progress,
  onProgressToggle,
  onPDFExtracted,
  onBackToLibrary,
  showOnMobile,
}: SidebarProps) {
  const { theme, setTheme } = useTheme();
  const themeClasses = getThemeClasses(theme);
  const [soundOn, setSoundOn] = useSoundEnabled();
  const [uploadError, setUploadError] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Keeps the highlighted page visible when it changes via Next/Prev or
  // when the sidebar is reopened (e.g. back on mobile).
  useEffect(() => {
    if (!activeSection || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-section-id="${CSS.escape(activeSection)}"]`
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeSection, showOnMobile]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

    setIsUploading(true);
    try {
      const extractedSections = await extractPDFText(file);
      if (onPDFExtracted) {
        await onPDFExtracted(extractedSections, file);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to process PDF';
      setUploadError(errorMsg);
      console.error('PDF extraction error:', error);
    } finally {
      setIsUploading(false);
    }
  };

  const total = sections.length;
  const done = progress.size;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div
      className={`w-full md:w-80 ${themeClasses.sidebg} ${themeClasses.sidetext} border-r ${themeClasses.border} ${
        showOnMobile ? 'flex' : 'hidden'
      } md:flex flex-col h-screen overflow-hidden`}
    >
      {/* Brand + actions */}
      <div className="p-4 pb-3">
        <div className="flex items-center gap-2.5 mb-4">
          <div
            className={`w-9 h-9 rounded-xl bg-gradient-to-br ${themeClasses.accent} flex items-center justify-center text-lg shadow-md`}
          >
            📖
          </div>
          <span className="text-lg font-extrabold tracking-tight">ReadEx</span>
        </div>

        <div className="flex gap-2">
          {onBackToLibrary && (
            <button
              onClick={onBackToLibrary}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border ${themeClasses.border} ${themeClasses.hover} transition`}
            >
              ← Library
            </button>
          )}
          <label
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium text-center cursor-pointer transition ${
              themeClasses.button
            } ${isUploading ? 'opacity-60 pointer-events-none' : ''}`}
          >
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={handleFileUpload}
              disabled={isUploading}
            />
            {isUploading ? '⏳ Processing…' : '＋ Add PDF'}
          </label>
        </div>

        {uploadError && (
          <div className="mt-3 p-2.5 rounded-lg text-xs bg-red-500/10 text-red-600 border border-red-500/20">
            ⚠️ {uploadError}
          </div>
        )}
      </div>

      {/* Reading progress */}
      <div className="px-4 pb-3">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="font-semibold uppercase tracking-wider opacity-60">Progress</span>
          <span className="opacity-60">
            {done} / {total} · {pct}%
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-current/10 overflow-hidden">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${themeClasses.accent} transition-all duration-500`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className={`border-t ${themeClasses.border}`} />

      {/* Pages list */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-3">
        <div className="space-y-0.5">
          {sections.map((section) => {
            const isActive = activeSection === section.id;
            const isDone = progress.has(section.id);
            return (
              <div
                key={section.id}
                data-section-id={section.id}
                onClick={() => onSectionSelect(section.id)}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition ${
                  isActive ? themeClasses.active : themeClasses.hover
                }`}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onProgressToggle(section.id);
                  }}
                  title={isDone ? 'Mark as unread' : 'Mark as read'}
                  className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center text-[11px] leading-none transition ${
                    isDone
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'border-current opacity-30 hover:opacity-70'
                  }`}
                >
                  {isDone && '✓'}
                </button>
                <span className={`flex-1 text-sm truncate ${isActive ? 'font-semibold' : 'font-medium'}`}>
                  {section.title}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Theme + sound */}
      <div className={`p-3 border-t ${themeClasses.border}`}>
        <div className={`grid grid-cols-2 gap-1 p-1 rounded-xl border ${themeClasses.border}`}>
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.name}
              onClick={() => setTheme(opt.name)}
              className={`py-1.5 text-xs rounded-lg font-semibold transition ${
                theme === opt.name ? `${themeClasses.active} shadow-sm` : themeClasses.hover
              }`}
            >
              <span className="mr-1">{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setSoundOn(!soundOn)}
          className={`mt-2 w-full py-1.5 text-xs rounded-lg font-semibold border ${themeClasses.border} ${themeClasses.hover} transition`}
          title="Turn click and page-turn sounds on or off"
        >
          {soundOn ? '🔊 Sounds on' : '🔇 Sounds off'}
        </button>
      </div>
    </div>
  );
}