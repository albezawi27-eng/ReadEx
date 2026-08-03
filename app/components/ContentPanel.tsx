'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTheme, getThemeClasses } from '@/app/context/ThemeContext';
import { PageCrop } from '@/app/utils/pdfParser';

interface Section {
  id: string;
  title: string;
  content: string;
  crops?: PageCrop[];
}

interface ContentPanelProps {
  activeSection: Section | null;
  highlightedLines: Set<number>;
  onLineClick: (lineIndex: number) => void;
  pdfFile?: File | null;
  noteValue: string;
  onNoteChange: (text: string) => void;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.1;

// Displayed page size relative to native PDF point size (1.0 = 612px for
// Letter). Raster is captured at scale=2.0, so 1.4x display still
// oversamples ~1.4x -- stays sharp, just fills more of the panel.
const PAGE_DISPLAY_SCALE = 1.4;

function PageRenderer({ pdfFile, crop, theme }: { pdfFile: File; crop: PageCrop; theme: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isRendering, setIsRendering] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let renderTask: any = null;

    const renderPage = async () => {
      if (!pdfFile || !crop || !canvasRef.current || !wrapperRef.current) return;

      try {
        setIsRendering(true);
        const pdfjsModule = await import('pdfjs-dist');
        const pdfjsLib = pdfjsModule;

        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
        }

        const arrayBuffer = await pdfFile.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(crop.pageNum);

        if (isCancelled) return;

        const canvas = canvasRef.current;
        const wrapper = wrapperRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;

        const scale = 2.0;
        const viewport = page.getViewport({ scale });

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const [, y1] = viewport.convertToViewportPoint(0, crop.pdfStartY);
        const [, y2] = viewport.convertToViewportPoint(0, crop.pdfEndY);

        const yTop = Math.max(0, y1 - 40);
        const yBottom = Math.min(viewport.height, y2 + 40);

        const cssTop = (yTop / scale) * PAGE_DISPLAY_SCALE;
        const cssHeight = ((yBottom - yTop) / scale) * PAGE_DISPLAY_SCALE;
        const cssWidth = (viewport.width / scale) * PAGE_DISPLAY_SCALE;

        wrapper.style.height = `${cssHeight}px`;
        wrapper.style.width = `${cssWidth}px`;
        wrapper.style.maxWidth = '100%';
        wrapper.style.overflow = 'hidden';
        wrapper.style.position = 'relative';

        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${(viewport.height / scale) * PAGE_DISPLAY_SCALE}px`;
        canvas.style.position = 'absolute';
        canvas.style.top = `-${cssTop}px`;
        canvas.style.left = '50%';
        canvas.style.transform = 'translateX(-50%)';

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };

        if (!isCancelled) {
          renderTask = page.render(renderContext);
          await renderTask.promise;
        }
      } catch (e: any) {
        if (e?.name !== 'RenderingCancelledException') {
          console.error('Page rendering error:', e);
        }
      } finally {
        if (!isCancelled) setIsRendering(false);
      }
    };

    renderPage();
    return () => {
      isCancelled = true;
      if (renderTask) {
        try {
          renderTask.cancel();
        } catch (e) {}
      }
    };
  }, [pdfFile, crop]);

  return (
    <div className="flex flex-col items-center w-full mb-8">
      <div className="text-xs opacity-40 mb-2 font-semibold tracking-wider uppercase">
        Page {crop.pageNum}
      </div>
      <div
        ref={wrapperRef}
        className={`bg-white shadow-2xl relative mx-auto transition-opacity duration-300 ${
          theme === 'dark' ? 'ring-1 ring-[#3a3b42]' : ''
        }`}
      >
        <canvas
          ref={canvasRef}
          style={{ filter: theme === 'dark' ? 'brightness(0.92)' : 'none' }}
          className={isRendering ? 'opacity-30' : 'opacity-100'}
        />
        {isRendering && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-5">
            <span className="px-3 py-1 bg-white text-black text-xs font-semibold rounded shadow">
              Rendering...
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ContentPanel({
  activeSection,
  highlightedLines,
  onLineClick,
  pdfFile,
  noteValue,
  onNoteChange,
}: ContentPanelProps) {
  const { theme } = useTheme();
  const themeClasses = getThemeClasses(theme);
  const [zoomLevel, setZoomLevel] = useState(1);
  const contentAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;

      const insideContent = !!contentAreaRef.current?.contains(e.target as Node);
      e.preventDefault();
      if (!insideContent) return;

      setZoomLevel((prev) => {
        const next = prev - e.deltaY * 0.001;
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      });
    };

    document.addEventListener('wheel', handleWheel, { passive: false });
    return () => document.removeEventListener('wheel', handleWheel);
  }, []);

  const adjustZoom = (delta: number) => {
    setZoomLevel((prev) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + delta)));
  };

  if (!activeSection) {
    return (
      <div className={`flex-1 ${themeClasses.bg} ${themeClasses.text} flex items-center justify-center p-8`}>
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-4 opacity-50">ReadEx</h1>
          <p className="text-lg opacity-75">Select a section to start reading</p>
        </div>
      </div>
    );
  }

  const isCanvasMode = !!(pdfFile && activeSection.crops && activeSection.crops.length > 0);
  const lines = activeSection.content.split('\n').filter((line) => line.trim());

  return (
    <div className={`flex-1 ${themeClasses.bg} ${themeClasses.text} flex flex-col overflow-hidden relative`}>
      <div
        className={`px-8 py-6 border-b ${themeClasses.border} border-opacity-20 shrink-0 flex justify-between items-center`}
      >
        <h1 className="text-3xl font-bold truncate max-w-xl">{activeSection.title}</h1>
        {isCanvasMode && (
          <span className="text-xs opacity-50 px-3 py-1 border border-current rounded-full uppercase tracking-wider font-semibold">
            Visual Section
          </span>
        )}
      </div>

      <div className={`px-8 py-4 border-b ${themeClasses.border} border-opacity-20 shrink-0`}>
        <label className="block text-xs font-semibold uppercase opacity-60 mb-2 tracking-wider">
          Notes
        </label>
        <textarea
          key={activeSection.id}
          value={noteValue}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="Jot down thoughts on this section..."
          rows={3}
          className={`w-full px-3 py-2 rounded-lg text-sm resize-y bg-transparent border ${themeClasses.border} border-opacity-30 focus:outline-none focus:ring-1 focus:ring-current`}
        />
      </div>

      <div
        ref={contentAreaRef}
        style={{ zoom: zoomLevel }}
        className={`flex-1 overflow-y-auto px-8 py-8 ${isCanvasMode ? 'bg-black bg-opacity-5 flex flex-col items-center' : ''}`}
      >
        {isCanvasMode ? (
          <div className="w-full max-w-5xl">
            {activeSection.crops!.map((crop, index) => (
              <PageRenderer key={`${activeSection.id}-${crop.pageNum}-${index}`} pdfFile={pdfFile!} crop={crop} theme={theme} />
            ))}
          </div>
        ) : (
          <div className="max-w-3xl">
            {lines.map((line, index) => (
              <div
                key={index}
                onClick={() => onLineClick(index)}
                className={`py-2 px-3 mb-2 rounded cursor-pointer transition duration-200 ${
                  highlightedLines.has(index) ? `${themeClasses.active} font-medium` : themeClasses.line
                }`}
              >
                <span className="inline-block mr-3 text-xs opacity-40">{index + 1}</span>
                {line}
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        className={`absolute bottom-6 right-6 flex items-center gap-1 px-2 py-1 rounded-full border ${themeClasses.border} border-opacity-30 ${themeClasses.sidebg} shadow-lg text-sm`}
      >
        <button onClick={() => adjustZoom(-ZOOM_STEP)} className={`w-7 h-7 rounded-full flex items-center justify-center ${themeClasses.hover}`} title="Zoom out">
          −
        </button>
        <button onClick={() => setZoomLevel(1)} className={`px-2 min-w-[3.2rem] text-center rounded ${themeClasses.hover}`} title="Reset zoom">
          {Math.round(zoomLevel * 100)}%
        </button>
        <button onClick={() => adjustZoom(ZOOM_STEP)} className={`w-7 h-7 rounded-full flex items-center justify-center ${themeClasses.hover}`} title="Zoom in">
          +
        </button>
      </div>

      <div className={`px-8 py-4 border-t ${themeClasses.border} border-opacity-20 text-sm opacity-60 shrink-0`}>
        {isCanvasMode ? (
          <span>Spans {activeSection.crops!.length} page(s)</span>
        ) : (
          <>
            <span>{lines.length} lines</span>
            <span className="mx-2">•</span>
            <span>{highlightedLines.size} highlighted</span>
          </>
        )}
      </div>
    </div>
  );
}