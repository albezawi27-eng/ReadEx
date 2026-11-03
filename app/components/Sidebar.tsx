'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme, getThemeClasses, THEME_OPTIONS } from '@/app/context/ThemeContext';
import { extractPDFText, PDFSection, Topic } from '@/app/utils/pdfParser';
import { useSoundEnabled } from '@/app/utils/sounds';
import { getSetting, setSetting } from '@/app/utils/db';

interface Section {
  id: string;
  title: string;
  content: string;
  crops?: { pageNum: number }[];
}

type SidebarMode = 'pages' | 'topics';

interface SidebarProps {
  sections: Section[];
  activeSection: string | null;
  onSectionSelect: (id: string) => void;
  progress: Set<string>;
  onProgressToggle: (id: string) => void;
  onProgressSet?: (ids: string[], done: boolean) => void;
  topics?: Topic[];
  topicsStatus?: 'loading' | 'ready' | 'none';
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
  onProgressSet,
  topics = [],
  topicsStatus = 'none',
  onPDFExtracted,
  onBackToLibrary,
  showOnMobile,
}: SidebarProps) {
  const { theme, setTheme } = useTheme();
  const themeClasses = getThemeClasses(theme);
  const [soundOn, setSoundOn] = useSoundEnabled();
  const [uploadError, setUploadError] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [mode, setMode] = useState<SidebarMode>('pages');
  const [modeLoaded, setModeLoaded] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [lastActiveTopic, setLastActiveTopic] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pendingScrollRef = useRef(false);

  // Remembers the Pages / Topics choice between visits.
  useEffect(() => {
    let cancelled = false;
    getSetting('sidebarMode')
      .then((value) => {
        if (cancelled) return;
        if (value === 'topics' || value === 'pages') setMode(value);
        setModeLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setModeLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const changeMode = (next: SidebarMode) => {
    setMode(next);
    setSetting('sidebarMode', next).catch(() => {});
  };

  const sectionById = useMemo(() => {
    const map = new Map<string, Section>();
    sections.forEach((s) => map.set(s.id, s));
    return map;
  }, [sections]);
  const pageNumById = useMemo(() => {
    const map = new Map<string, number>();
    sections.forEach((s, i) => map.set(s.id, s.crops?.[0]?.pageNum ?? i + 1));
    return map;
  }, [sections]);

  // Each topic with the ids of the pages inside it.
  const topicGroups = useMemo(
    () =>
      topics.map((topic) => ({
        topic,
        ids: sections
          .filter((s) => {
            const page = pageNumById.get(s.id) ?? 0;
            return page >= topic.startPage && page <= topic.endPage;
          })
          .map((s) => s.id),
      })),
    [topics, sections, pageNumById]
  );

  const activeTopicIdx = useMemo(() => {
    if (!activeSection) return null;
    const idx = topicGroups.findIndex((g) => g.ids.includes(activeSection));
    return idx === -1 ? null : idx;
  }, [activeSection, topicGroups]);

  const showTopics = mode === 'topics' && topicsStatus === 'ready' && topicGroups.length > 0;

  // Opens the topic you are reading whenever you move into a new one.
  if (activeTopicIdx !== lastActiveTopic) {
    setLastActiveTopic(activeTopicIdx);
    if (activeTopicIdx !== null) {
      setExpanded((prev) => new Set(prev).add(activeTopicIdx));
    }
  }

  // Keeps the current page visible in the list. Waits (via the pending flag)
  // until the row actually exists, since a collapsed topic hides its pages.
  useEffect(() => {
    pendingScrollRef.current = true;
  }, [activeSection, showOnMobile, showTopics]);

  useEffect(() => {
    if (!pendingScrollRef.current || !activeSection || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-section-id="${CSS.escape(activeSection)}"]`
    );
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
      pendingScrollRef.current = false;
    }
  });

  const toggleExpanded = (idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const jumpToTopic = (idx: number, ids: string[]) => {
    setExpanded((prev) => new Set(prev).add(idx));
    if (ids[0]) onSectionSelect(ids[0]);
  };

  const setIdsDone = (ids: string[], done: boolean) => {
    if (onProgressSet) {
      onProgressSet(ids, done);
      return;
    }
    ids.forEach((id) => {
      if (progress.has(id) !== done) onProgressToggle(id);
    });
  };

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

  const renderPageRow = (section: Section, compact: boolean) => {
    const isActive = activeSection === section.id;
    const isDone = progress.has(section.id);
    return (
      <div
        key={section.id}
        data-section-id={section.id}
        onClick={() => onSectionSelect(section.id)}
        className={`flex items-center gap-2.5 ${
          compact ? 'px-2 py-1.5' : 'px-2.5 py-2'
        } rounded-lg cursor-pointer transition ${isActive ? themeClasses.active : themeClasses.hover}`}
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

      {/* Pages / Topics switch */}
      <div className="px-3 pt-3">
        <div className={`grid grid-cols-2 gap-1 p-1 rounded-xl border ${themeClasses.border}`}>
          {(
            [
              { value: 'pages', label: 'Pages', icon: '📄' },
              { value: 'topics', label: 'Topics', icon: '🗂️' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              onClick={() => changeMode(opt.value)}
              className={`py-1.5 text-xs rounded-lg font-semibold transition ${
                mode === opt.value ? `${themeClasses.active} shadow-sm` : themeClasses.hover
              }`}
            >
              <span className="mr-1">{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>
        {mode === 'topics' && topicsStatus === 'loading' && (
          <p className="text-[11px] opacity-60 mt-2 px-1">Detecting topics…</p>
        )}
        {mode === 'topics' && topicsStatus === 'none' && (
          <p className="text-[11px] opacity-60 mt-2 px-1">
            No topics found in this document — showing pages.
          </p>
        )}
      </div>

      {/* List */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-3">
        {modeLoaded &&
          (showTopics ? (
            <div>
              {topicGroups.map((group, idx) => {
                const { topic, ids } = group;
                const doneCount = ids.filter((id) => progress.has(id)).length;
                const allDone = ids.length > 0 && doneCount === ids.length;
                const partial = doneCount > 0 && !allDone;
                const isActiveTopic = idx === activeTopicIdx;
                const isOpen = expanded.has(idx);
                const rangeLabel =
                  topic.startPage === topic.endPage
                    ? `p. ${topic.startPage}`
                    : `pp. ${topic.startPage}–${topic.endPage}`;

                return (
                  <div key={`${topic.startPage}-${idx}`} className="mb-1">
                    <div
                      onClick={() => jumpToTopic(idx, ids)}
                      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition ${
                        isActiveTopic ? themeClasses.active : themeClasses.hover
                      }`}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setIdsDone(ids, !allDone);
                        }}
                        title={allDone ? 'Mark topic as unread' : 'Mark whole topic as read'}
                        className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center text-[11px] leading-none transition ${
                          allDone
                            ? 'bg-emerald-500 border-emerald-500 text-white'
                            : partial
                              ? 'border-emerald-500 text-emerald-500'
                              : 'border-current opacity-30 hover:opacity-70'
                        }`}
                      >
                        {allDone ? '✓' : partial ? '•' : ''}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm truncate ${isActiveTopic ? 'font-semibold' : 'font-medium'}`}>
                          {topic.title}
                        </div>
                        <div className="text-[11px] opacity-60">
                          {rangeLabel} · {doneCount}/{ids.length} read
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpanded(idx);
                        }}
                        title={isOpen ? 'Hide pages' : 'Show pages'}
                        className={`shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-xs ${themeClasses.hover}`}
                      >
                        {isOpen ? '▾' : '▸'}
                      </button>
                    </div>

                    {isOpen && (
                      <div className={`ml-5 mt-0.5 pl-2 border-l ${themeClasses.border} space-y-0.5`}>
                        {ids.map((id) => {
                          const section = sectionById.get(id);
                          return section ? renderPageRow(section, true) : null;
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-0.5">{sections.map((section) => renderPageRow(section, false))}</div>
          ))}
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