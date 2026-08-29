'use client';

import React, { useEffect, useRef, useState } from 'react';
import { TransformWrapper, TransformComponent, ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { useTheme, getThemeClasses } from '@/app/context/ThemeContext';
import { PageCrop } from '@/app/utils/pdfParser';
import { StoredAnnotationItem } from '@/app/utils/db';
import { useAnnotations } from '@/app/hooks/useAnnotations';
import AnnotationLayer from '@/app/components/AnnotationLayer';
import AskAI from '@/app/components/AskAI';

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
  activeBookId: string | null;
  noteValue: string;
  onNoteChange: (text: string) => void;
  showOnMobile: boolean;
  onShowSidebar: () => void;
  onNavigateSection: (direction: 'prev' | 'next') => void;
  prevSectionTitle: string | null;
  nextSectionTitle: string | null;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.1;
const PAGE_DISPLAY_SCALE = 1.4;
const FOCUS_MODE_MAX_SCALE = 3;
const DRAW_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#111827'];
const DRAW_WIDTHS = [2, 4, 7];

function PageRenderer({
  pdfFile,
  crop,
  theme,
  focusMode,
  containerWidth,
  containerHeight,
  onNativeSizeReady,
  children,
}: {
  pdfFile: File;
  crop: PageCrop;
  theme: string;
  focusMode: boolean;
  containerWidth: number | null;
  containerHeight: number | null;
  onNativeSizeReady?: (width: number, height: number) => void;
  children?: React.ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isRendering, setIsRendering] = useState(false);
  const rawDimsRef = useRef<{
    viewportWidth: number;
    viewportHeight: number;
    scale: number;
    yTop: number;
    yBottom: number;
  } | null>(null);

  const applySizing = () => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    const dims = rawDimsRef.current;
    if (!canvas || !wrapper || !dims) return;

    const { viewportWidth, viewportHeight, scale, yTop, yBottom } = dims;
    const nativeCssWidth = viewportWidth / scale;
    const nativeCssCropHeight = (yBottom - yTop) / scale;

    const availableWidth = containerWidth || nativeCssWidth * PAGE_DISPLAY_SCALE;
    const widthScale = availableWidth / nativeCssWidth;

    let effectiveScale: number;
    if (focusMode && containerHeight) {
      const heightScale = (containerHeight - 24) / nativeCssCropHeight;
      effectiveScale = Math.min(FOCUS_MODE_MAX_SCALE, widthScale, heightScale);
    } else {
      effectiveScale = Math.min(PAGE_DISPLAY_SCALE, widthScale);
    }

    const cssTop = (yTop / scale) * effectiveScale;
    const cssHeight = nativeCssCropHeight * effectiveScale;
    const cssWidth = nativeCssWidth * effectiveScale;
    const cssFullHeight = (viewportHeight / scale) * effectiveScale;

    wrapper.style.height = `${cssHeight}px`;
    wrapper.style.width = `${cssWidth}px`;
    wrapper.style.maxWidth = '100%';
    wrapper.style.overflow = 'hidden';
    wrapper.style.position = 'relative';

    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssFullHeight}px`;
    canvas.style.position = 'absolute';
    canvas.style.top = `-${cssTop}px`;
    canvas.style.left = '50%';
    canvas.style.transform = 'translateX(-50%)';
  };

  useEffect(() => {
    if (rawDimsRef.current) applySizing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMode, containerWidth, containerHeight]);

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

        rawDimsRef.current = {
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
          scale,
          yTop,
          yBottom,
        };

        onNativeSizeReady?.(viewport.width / scale, (yBottom - yTop) / scale);
        applySizing();

        const renderContext = { canvasContext: context, viewport };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfFile, crop]);

  return (
    <div className={`flex flex-col items-center w-full ${focusMode ? '' : 'mb-8'}`}>
      {!focusMode && (
        <div className="text-xs opacity-40 mb-2 font-semibold tracking-wider uppercase">
          Page {crop.pageNum}
        </div>
      )}
      <div
        ref={wrapperRef}
        className={`bg-white shadow-2xl relative mx-auto transition-opacity duration-300 ${
          theme === 'dark' && !focusMode ? 'ring-1 ring-[#3a3b42]' : ''
        }`}
      >
        <canvas
          ref={canvasRef}
          style={{ filter: theme === 'dark' && !focusMode ? 'brightness(0.92)' : 'none' }}
          className={isRendering ? 'opacity-30' : 'opacity-100'}
        />
        {isRendering && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-5">
            <span className="px-3 py-1 bg-white text-black text-xs font-semibold rounded shadow">
              Rendering...
            </span>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export default function ContentPanel({
  activeSection,
  highlightedLines,
  onLineClick,
  pdfFile,
  activeBookId,
  noteValue,
  onNoteChange,
  showOnMobile,
  onShowSidebar,
  onNavigateSection,
  prevSectionTitle,
  nextSectionTitle,
}: ContentPanelProps) {
  const { theme } = useTheme();
  const themeClasses = getThemeClasses(theme);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isAskAIOpen, setIsAskAIOpen] = useState(false);
  const [contentWidth, setContentWidth] = useState<number | null>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<ReactZoomPanPinchRef>(null);

  const [isDrawMode, setIsDrawMode] = useState(false);
  const [drawTool, setDrawTool] = useState<'pen' | 'eraser' | 'text'>('pen');
  const [drawColor, setDrawColor] = useState(DRAW_COLORS[0]);
  const [drawWidth, setDrawWidth] = useState(DRAW_WIDTHS[0]);
  const [nativeSizeByPage, setNativeSizeByPage] = useState<
  Record<number, { width: number; height: number }>
>({});

  const isCanvasMode = !!(pdfFile && activeSection?.crops && activeSection.crops.length > 0);
  const isCanvasModeRef = useRef(isCanvasMode);
  isCanvasModeRef.current = isCanvasMode;

  const pageNums = activeSection?.crops?.map((c) => c.pageNum) ?? [];
  const {
    itemsByPage,
    addItem: addAnnotationItem,
    removeItem: removeAnnotationItem,
    undo: undoAnnotation,
    redo: redoAnnotation,
    canUndo,
    canRedo,
  } = useAnnotations(activeBookId, pageNums);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      if (isCanvasModeRef.current) return;
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement ||
        target?.isContentEditable;
      if (isTyping) return;

      if (e.key === 'ArrowLeft') {
        onNavigateSection('prev');
      } else if (e.key === 'ArrowRight') {
        onNavigateSection('next');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onNavigateSection]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsFocusMode(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const el = contentAreaRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContentWidth(entry.contentRect.width);
        setContentHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeSection?.id, isFocusMode]);

  useEffect(() => {
    transformRef.current?.resetTransform(0);
    setZoomLevel(1);
  }, [activeSection?.id]);

  const toggleFocusMode = () => {
    if (isFocusMode) {
      setIsFocusMode(false);
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    } else {
      setIsFocusMode(true);
      panelRef.current?.requestFullscreen?.().catch(() => {});
    }
  };

  const adjustZoom = (delta: number) => {
    if (isCanvasMode && transformRef.current) {
      if (delta > 0) {
        transformRef.current.zoomIn(delta, 200);
      } else {
        transformRef.current.zoomOut(Math.abs(delta), 200);
      }
    } else {
      setZoomLevel((prev) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + delta)));
    }
  };

  const resetZoom = () => {
    if (isCanvasMode && transformRef.current) {
      transformRef.current.resetTransform();
    } else {
      setZoomLevel(1);
    }
  };

  const rootVisibilityClass = `${showOnMobile ? 'flex' : 'hidden'} md:flex`;

  if (!activeSection) {
    return (
      <div className={`flex-1 ${themeClasses.bg} ${themeClasses.text} ${rootVisibilityClass} items-center justify-center p-8`}>
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-4 opacity-50">ReadEx</h1>
          <p className="text-lg opacity-75">Select a section to start reading</p>
        </div>
      </div>
    );
  }

  const lines = activeSection.content.split('\n').filter((line) => line.trim());
  const hasPrev = !!prevSectionTitle;
  const hasNext = !!nextSectionTitle;

  return (
    <div
      ref={panelRef}
      className={`flex-1 ${themeClasses.bg} ${themeClasses.text} ${rootVisibilityClass} flex-col overflow-hidden relative`}
    >
      {/* Header */}
      <div
        className={`px-4 py-3 md:px-8 md:py-6 border-b ${themeClasses.border} border-opacity-20 shrink-0 flex justify-between items-center gap-3`}
      >
        {!isFocusMode && (
          <button
            onClick={onShowSidebar}
            className={`md:hidden shrink-0 text-sm px-3 py-1.5 rounded-lg border ${themeClasses.border} border-opacity-30 ${themeClasses.hover}`}
          >
            ← Sections
          </button>
        )}
        <h1 className="text-lg md:text-3xl font-bold truncate flex-1 md:max-w-xl">{activeSection.title}</h1>
        {isCanvasMode && !isFocusMode && (
          <span className="hidden md:inline-block text-xs opacity-50 px-3 py-1 border border-current rounded-full uppercase tracking-wider font-semibold shrink-0">
            Visual Section
          </span>
        )}
        {isCanvasMode && !isFocusMode && (
          <button
            onClick={() => setIsDrawMode((v) => !v)}
            className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center border ${themeClasses.border} border-opacity-30 ${
              isDrawMode ? themeClasses.active : themeClasses.hover
            }`}
            title="Draw on page"
          >
            ✏️
          </button>
        )}
        {!isFocusMode && (
          <button
            onClick={() => setIsAskAIOpen((v) => !v)}
            className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center border ${themeClasses.border} border-opacity-30 ${themeClasses.hover}`}
            title="Ask AI about this book"
          >
            💬
          </button>
        )}
        <button
          onClick={toggleFocusMode}
          className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center border ${themeClasses.border} border-opacity-30 ${themeClasses.hover}`}
          title={isFocusMode ? 'Exit fullscreen' : 'Fullscreen reading mode'}
        >
          {isFocusMode ? '✕' : '⛶'}
        </button>
      </div>

      {/* Notes -- hidden in focus mode */}
      {!isFocusMode && (
        <div className={`px-4 py-3 md:px-8 md:py-4 border-b ${themeClasses.border} border-opacity-20 shrink-0`}>
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
      )}

      {/* Content Area */}
      <div
        ref={contentAreaRef}
        className={`flex-1 overflow-hidden relative ${
          isCanvasMode ? (isFocusMode ? 'bg-white' : 'bg-black bg-opacity-5') : ''
        }`}
      >
        {isCanvasMode ? (
          <TransformWrapper
            ref={transformRef}
            initialScale={1}
            minScale={MIN_ZOOM}
            maxScale={MAX_ZOOM}
            limitToBounds={false}
            centerOnInit
            doubleClick={{ disabled: true }}
            panning={{ disabled: isDrawMode }}
            pinch={{ disabled: isDrawMode }}
            wheel={{ disabled: isDrawMode }}
            onTransform={(_, state) => setZoomLevel(state.scale)}
          >
            <TransformComponent
              wrapperStyle={{ width: '100%', height: '100%' }}
              contentStyle={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                width: '100%',
                padding: isFocusMode ? '0' : '1rem',
              }}
            >
              <div className={`w-full ${isFocusMode ? 'flex flex-col items-center' : 'max-w-5xl'}`}>
                {activeSection.crops!.map((crop, index) => (
                  <PageRenderer
                    key={`${activeSection.id}-${crop.pageNum}-${index}`}
                    pdfFile={pdfFile!}
                    crop={crop}
                    theme={theme}
                    focusMode={isFocusMode}
                    containerWidth={contentWidth}
                    containerHeight={contentHeight}
                    onNativeSizeReady={(w, h) =>
                      setNativeSizeByPage((prev: any) => ({ ...prev, [crop.pageNum]: { width: w, height: h } }))
                    }
                  >
                    {nativeSizeByPage[crop.pageNum] && (
                      <AnnotationLayer
                        items={itemsByPage[crop.pageNum] ?? []}
                        nativeWidth={nativeSizeByPage[crop.pageNum].width}
                        nativeHeight={nativeSizeByPage[crop.pageNum].height}
                        tool={drawTool}
                        color={drawColor}
                        strokeWidth={drawWidth}
                        isActive={isDrawMode}
                        onAddItem={(item: StoredAnnotationItem) => addAnnotationItem(crop.pageNum, item)}
                        onRemoveItem={(item: StoredAnnotationItem) => removeAnnotationItem(crop.pageNum, item)}
                      />
                    )}
                  </PageRenderer>
                ))}
              </div>
            </TransformComponent>
          </TransformWrapper>
        ) : (
          <div
            style={{ zoom: zoomLevel }}
            className="w-full h-full overflow-auto px-4 py-4 md:px-8 md:py-8"
          >
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
          </div>
        )}

        {isDrawMode && isCanvasMode && (
          <div
            className={`absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-2 rounded-full border ${themeClasses.border} border-opacity-30 ${themeClasses.sidebg} shadow-lg z-20 flex-wrap justify-center max-w-[95%]`}
          >
            <button
              onClick={() => setDrawTool('pen')}
              className={`w-8 h-8 rounded-full flex items-center justify-center ${drawTool === 'pen' ? themeClasses.active : themeClasses.hover}`}
              title="Pen"
            >
              ✏️
            </button>
            <button
              onClick={() => setDrawTool('eraser')}
              className={`w-8 h-8 rounded-full flex items-center justify-center ${drawTool === 'eraser' ? themeClasses.active : themeClasses.hover}`}
              title="Eraser"
            >
              🧽
            </button>
            <button
              onClick={() => setDrawTool('text')}
              className={`w-8 h-8 rounded-full flex items-center justify-center ${drawTool === 'text' ? themeClasses.active : themeClasses.hover}`}
              title="Text"
            >
              🔤
            </button>
            <div className="w-px h-5 bg-current opacity-20 mx-1" />
            {DRAW_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setDrawColor(c)}
                className={`w-6 h-6 rounded-full border-2 ${drawColor === c ? 'border-current' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
                title="Color"
              />
            ))}
            <div className="w-px h-5 bg-current opacity-20 mx-1" />
            {DRAW_WIDTHS.map((w) => (
              <button
                key={w}
                onClick={() => setDrawWidth(w)}
                className={`w-8 h-8 rounded-full flex items-center justify-center ${drawWidth === w ? themeClasses.active : themeClasses.hover}`}
                title={`Width ${w}`}
              >
                <span
                  style={{
                    width: w + 2,
                    height: w + 2,
                    borderRadius: '50%',
                    backgroundColor: 'currentColor',
                    display: 'inline-block',
                  }}
                />
              </button>
            ))}
            <div className="w-px h-5 bg-current opacity-20 mx-1" />
            <button
              onClick={undoAnnotation}
              disabled={!canUndo}
              className={`w-8 h-8 rounded-full flex items-center justify-center ${canUndo ? themeClasses.hover : 'opacity-30 cursor-not-allowed'}`}
              title="Undo"
            >
              ↶
            </button>
            <button
              onClick={redoAnnotation}
              disabled={!canRedo}
              className={`w-8 h-8 rounded-full flex items-center justify-center ${canRedo ? themeClasses.hover : 'opacity-30 cursor-not-allowed'}`}
              title="Redo"
            >
              ↷
            </button>
          </div>
        )}
      </div>

      {/* Section Navigation */}
      <div
        className={`px-4 py-2.5 md:px-8 md:py-3 border-t ${themeClasses.border} border-opacity-20 shrink-0 flex items-center gap-2`}
      >
        <button
          onClick={() => onNavigateSection('prev')}
          disabled={!hasPrev}
          className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition min-w-0 ${
            hasPrev
              ? `${themeClasses.hover} border ${themeClasses.border} border-opacity-30`
              : 'opacity-30 cursor-not-allowed'
          }`}
        >
          <span className="shrink-0">←</span>
          <span className="truncate">{prevSectionTitle || 'Previous'}</span>
        </button>
        <button
          onClick={() => onNavigateSection('next')}
          disabled={!hasNext}
          className={`flex-1 flex items-center justify-end gap-2 px-3 py-2 rounded-lg text-sm font-medium transition min-w-0 ${
            hasNext
              ? `${themeClasses.hover} border ${themeClasses.border} border-opacity-30`
              : 'opacity-30 cursor-not-allowed'
          }`}
        >
          <span className="truncate">{nextSectionTitle || 'Next'}</span>
          <span className="shrink-0">→</span>
        </button>
      </div>

      {/* Floating zoom control */}
      <div
        className={`absolute bottom-20 right-4 md:bottom-24 md:right-6 flex items-center gap-1 px-2 py-1 rounded-full border ${themeClasses.border} border-opacity-30 ${themeClasses.sidebg} shadow-lg text-sm z-10`}
      >
        <button
          onClick={() => adjustZoom(-ZOOM_STEP)}
          className={`w-9 h-9 md:w-7 md:h-7 rounded-full flex items-center justify-center ${themeClasses.hover}`}
          title="Zoom out"
        >
          −
        </button>
        <button
          onClick={resetZoom}
          className={`px-2 min-w-[3.2rem] text-center rounded ${themeClasses.hover}`}
          title="Reset zoom"
        >
          {Math.round(zoomLevel * 100)}%
        </button>
        <button
          onClick={() => adjustZoom(ZOOM_STEP)}
          className={`w-9 h-9 md:w-7 md:h-7 rounded-full flex items-center justify-center ${themeClasses.hover}`}
          title="Zoom in"
        >
          +
        </button>
      </div>

      {/* Footer Stats -- hidden in focus mode */}
      {!isFocusMode && (
        <div className={`px-4 py-2 md:px-8 md:py-3 border-t ${themeClasses.border} border-opacity-20 text-xs md:text-sm opacity-60 shrink-0`}>
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
      )}

      {isAskAIOpen && (
        <AskAI pdfFile={pdfFile ?? null} bookId={activeBookId} onClose={() => setIsAskAIOpen(false)} />
      )}
    </div>
  );
}