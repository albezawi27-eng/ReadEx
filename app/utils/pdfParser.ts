'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { getSetting, setSetting } from '@/app/utils/db';

// Try to import from installed package first, fall back to CDN
let pdfjsLib: any = null;
let pdfjsLoaded = false;

export interface PageCrop {
  pageNum: number;
  pdfStartY: number; // Higher value (top of page in PDF coords)
  pdfEndY: number;   // Lower value (bottom of page in PDF coords)
}

export interface PDFSection {
  id: number;
  title: string;
  content: string;
  crops?: PageCrop[];
}

// A topic is a run of consecutive pages that belong together (a chapter).
export interface Topic {
  title: string;
  startPage: number;
  endPage: number;
}

async function loadPDFJS(): Promise<any> {
  if (pdfjsLoaded && pdfjsLib) return pdfjsLib;

  if (typeof window === 'undefined') {
    throw new Error('PDF parsing only works in browser');
  }

  try {
    try {
      const pdfjsModule = await import('pdfjs-dist');
      pdfjsLib = pdfjsModule;
      pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
      pdfjsLoaded = true;
      return pdfjsLib;
    } catch {
      // Fall back to CDN
    }

    if ((window as any).pdfjsLib) {
      pdfjsLib = (window as any).pdfjsLib;
      pdfjsLoaded = true;
      return pdfjsLib;
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.min.js';
      script.crossOrigin = 'anonymous';
      script.async = true;

      script.onload = () => {
        pdfjsLib = (window as any).pdfjsLib;
        if (!pdfjsLib) {
          reject(new Error('PDF.js library not found after loading'));
          return;
        }

        pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
        pdfjsLoaded = true;
        resolve(pdfjsLib);
      };

      script.onerror = () => {
        reject(new Error('Failed to load PDF.js from CDN'));
      };

      document.head.appendChild(script);
    });
  } catch (error) {
    throw error;
  }
}

// One sidebar entry per page, sized from each page's real dimensions.
// No text analysis at all, so this works identically for normal and
// scanned PDFs, and is much faster than reading every line of text.
export async function extractPDFText(file: File): Promise<PDFSection[]> {
  try {
    const pdfjsLib = await loadPDFJS();

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const sections: PDFSection[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      // page.view = [xMin, yMin, xMax, yMax] in PDF user space (y points up)
      const [, bottom, , top] = page.view;
      sections.push({
        id: p,
        title: `Page ${p}`,
        content: '',
        crops: [{ pageNum: p, pdfStartY: top, pdfEndY: bottom }],
      });
    }

    if (sections.length === 0) {
      throw new Error('This PDF has no pages.');
    }

    return sections;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new Error(`Failed to extract PDF: ${errorMessage}`);
  }
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

interface RawEntry {
  title: string;
  startPage: number;
  depth: number;
}

// Resolves a bookmark destination (named or explicit) to a 1-based page number.
async function resolveDestPage(pdf: any, dest: any): Promise<number | null> {
  try {
    let destArray = dest;
    if (typeof dest === 'string') destArray = await pdf.getDestination(dest);
    if (!Array.isArray(destArray) || destArray.length === 0) return null;
    const ref = destArray[0];
    if (ref && typeof ref === 'object') {
      const index = await pdf.getPageIndex(ref);
      return index + 1;
    }
    if (Number.isInteger(ref)) return ref + 1;
    return null;
  } catch {
    return null;
  }
}

async function flattenOutline(pdf: any, items: any[], depth: number, out: RawEntry[]): Promise<void> {
  for (const item of items) {
    const title = String(item.title ?? '').replace(/\s+/g, ' ').trim();
    if (item.dest && title) {
      const page = await resolveDestPage(pdf, item.dest);
      if (page !== null && page >= 1 && page <= pdf.numPages) {
        out.push({ title, startPage: page, depth });
      }
    }
    if (Array.isArray(item.items) && item.items.length > 0) {
      await flattenOutline(pdf, item.items, depth + 1, out);
    }
  }
}

// Uses the shallowest bookmark level that has at least two entries, so a
// book wrapped in a single "title" bookmark still yields chapters.
function pickTopicLevel(entries: RawEntry[]): RawEntry[] {
  for (let depth = 0; depth <= 3; depth++) {
    const level = entries.filter((e) => e.depth === depth);
    if (level.length >= 2) return level;
  }
  return entries;
}

function buildTopics(entries: RawEntry[], numPages: number): Topic[] {
  const sorted = [...entries].sort((a, b) => a.startPage - b.startPage);

  // One topic per start page: if several start on the same page, keep the first.
  const unique: RawEntry[] = [];
  for (const entry of sorted) {
    if (unique.length > 0 && unique[unique.length - 1].startPage === entry.startPage) continue;
    unique.push(entry);
  }
  if (unique.length < 2) return [];

  const topics: Topic[] = [];
  if (unique[0].startPage > 1) {
    topics.push({ title: 'Front matter', startPage: 1, endPage: unique[0].startPage - 1 });
  }
  unique.forEach((entry, i) => {
    const next = unique[i + 1];
    topics.push({
      title: entry.title.length > 80 ? entry.title.slice(0, 80) + '…' : entry.title,
      startPage: entry.startPage,
      endPage: next ? next.startPage - 1 : numPages,
    });
  });
  return topics;
}

const STRONG_SECTION_KEYWORDS =
  /^(abstract|introduction|conclusions?|references|bibliography|appendix|acknowledg(?:e)?ments?|discussion|methodology|methods|results?|summary|background|related\s*work|future\s*work|overview|motivation|preface|foreword|contents|glossary)\s*[:.]?$/i;
const EXPLICIT_CHAPTER = /^(?:Chapter|Section|Part|Appendix)\s+[\dIVXLC]+/i;
const TOP_LEVEL_NUMBERED_HEADING =
  /^(?:[IVXLC]+\.\s+[A-Z]|\d+\.?\s+[A-Z])[a-zA-Z0-9\s:,\-]*$/;
const SUBSECTION_NUMBERED_HEADING = /^(?:\d+(?:\.\d+)+|[A-Z]\.\d+)\s*[a-zA-Z0-9\s:,\-]*$/;
const PURE_TEXT_HEADING = /^[A-Z][a-zA-Z0-9\s:,\-]*$/;
const MATH_SYMBOLS =
  /[=+\-*/<>\u0370-\u03FF\u2070-\u209F\u2100-\u214F\u2190-\u21FF\u2200-\u22FF\u27C0-\u27EF\u2980-\u29FF\u2A00-\u2AFF\u20D0-\u20FF\u00B1\u00D7\u00F7\u00B2\u00B3\u00B9\u{1D400}-\u{1D7FF}\uE000-\uF8FF]/u;

const METADATA_LINE_PATTERNS = [
  /^(?:\d{1,2}[\/\-.\s])?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2},?\s*\d{2,4}$/i,
  /^\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i,
  /^\d{4}-\d{2}-\d{2}$/,
  /^(?:Department|Faculty|School|Institute|University|College)\s+of\b/i,
  /^[\w.+-]+@[\w-]+\.[\w.-]+$/,
  /orcid\.org|\borcid\b/i,
  /^(?:draft|preprint|working paper|version)\b/i,
  /^page\s+\d+(\s+of\s+\d+)?$/i,
  /^\d+$/,
  /^(?:arXiv|doi):/i,
];

function isMetadataLine(text: string): boolean {
  return METADATA_LINE_PATTERNS.some((re) => re.test(text));
}

interface TextLine {
  text: string;
  fontSize: number;
  pageNum: number;
}

function joinLineItems(items: { str: string; fontSize: number; x: number }[]): string {
  items.sort((a, b) => a.x - b.x);
  let text = items[0].str;
  for (let j = 1; j < items.length; j++) {
    const prev = items[j - 1];
    const curr = items[j];
    const estimatedPrevWidth = prev.str.length * (prev.fontSize * 0.5);
    if (
      curr.x - (prev.x + estimatedPrevWidth) > prev.fontSize * 0.2 &&
      !prev.str.endsWith(' ') &&
      !curr.str.startsWith(' ')
    ) {
      text += ' ';
    }
    text += curr.str;
  }
  return text.replace(/\s+/g, ' ').trim();
}

async function collectLines(pdf: any): Promise<TextLine[]> {
  const lines: TextLine[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    const items: { str: string; fontSize: number; x: number; y: number }[] = [];
    for (const item of content.items as any[]) {
      if (typeof item.str === 'string' && item.str.trim() !== '') {
        items.push({
          str: item.str,
          fontSize: Math.abs(item.transform[3]),
          x: item.transform[4],
          y: item.transform[5],
        });
      }
    }

    items.sort((a, b) => b.y - a.y || a.x - b.x);

    let group: typeof items = [];
    const flush = () => {
      if (group.length === 0) return;
      lines.push({
        text: joinLineItems(group),
        fontSize: Math.max(...group.map((g) => g.fontSize)),
        pageNum: p,
      });
      group = [];
    };

    for (const item of items) {
      if (group.length > 0 && Math.abs(item.y - group[0].y) >= 4) flush();
      group.push(item);
    }
    flush();

    page.cleanup?.();
  }

  return lines;
}

function mostCommonFontSize(lines: TextLine[]): number {
  const frequency = new Map<number, number>();
  for (const line of lines) {
    const size = Math.round(line.fontSize);
    frequency.set(size, (frequency.get(size) || 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [size, count] of frequency.entries()) {
    if (count > bestCount) {
      best = size;
      bestCount = count;
    }
  }
  return best;
}

// Fallback for PDFs with no bookmarks: finds top-level headings by their
// wording and font size. Deliberately strict -- better to find nothing than
// to fill the sidebar with noise.
async function detectTopicsByHeadings(pdf: any): Promise<RawEntry[]> {
  const lines = await collectLines(pdf);
  if (lines.length === 0) return [];

  const bodySize = mostCommonFontSize(lines);

  // Text repeated across many pages is a running header or footer.
  const pagesByText = new Map<string, Set<number>>();
  for (const line of lines) {
    const key = line.text.trim().toLowerCase();
    if (!pagesByText.has(key)) pagesByText.set(key, new Set());
    pagesByText.get(key)!.add(line.pageNum);
  }

  const entries: RawEntry[] = [];
  const pagesWithTopic = new Set<number>();

  for (const line of lines) {
    if (pagesWithTopic.has(line.pageNum)) continue;

    const text = line.text.trim();
    if (text.length < 3 || text.length >= 80) continue;
    if (isMetadataLine(text)) continue;
    if ((pagesByText.get(text.toLowerCase())?.size ?? 0) >= 3) continue;
    if (MATH_SYMBOLS.test(text)) continue;
    if (SUBSECTION_NUMBERED_HEADING.test(text)) continue;

    const ratio = bodySize > 0 ? line.fontSize / bodySize : 1;
    const larger = ratio > 1.15;
    const muchLarger = ratio > 1.3;
    const words = text.split(/\s+/).filter(Boolean).length;

    const isHeading =
      STRONG_SECTION_KEYWORDS.test(text) ||
      EXPLICIT_CHAPTER.test(text) ||
      (TOP_LEVEL_NUMBERED_HEADING.test(text) && larger) ||
      (PURE_TEXT_HEADING.test(text) && larger && (words >= 2 || muchLarger));

    if (isHeading) {
      entries.push({ title: text, startPage: line.pageNum, depth: 0 });
      pagesWithTopic.add(line.pageNum);
    }
  }

  // Far too many "headings" means the detection is just picking up noise.
  if (entries.length > 8 && entries.length > pdf.numPages * 0.5) return [];

  return entries;
}

export async function extractTopics(file: File): Promise<Topic[]> {
  try {
    const pdfjsLib = await loadPDFJS();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let entries: RawEntry[] = [];

    try {
      const outline = await pdf.getOutline();
      if (Array.isArray(outline) && outline.length > 0) {
        const flat: RawEntry[] = [];
        await flattenOutline(pdf, outline, 0, flat);
        entries = pickTopicLevel(flat);
      }
    } catch (err) {
      console.warn('Could not read PDF bookmarks:', err);
    }

    if (new Set(entries.map((e) => e.startPage)).size < 2) {
      entries = await detectTopicsByHeadings(pdf);
    }

    return buildTopics(entries, pdf.numPages);
  } catch (err) {
    // Topics are a convenience -- never let them break opening a book.
    console.warn('Topic detection failed:', err);
    return [];
  }
}

// Topics only depend on the file, so they're computed once per book and cached.
// Bump the version in the key if the detection logic ever changes.
export async function loadTopicsForBook(bookId: string, file: File): Promise<Topic[]> {
  const cacheKey = `topics-v1:${bookId}`;

  try {
    const cached = await getSetting(cacheKey);
    if (cached) return JSON.parse(cached) as Topic[];
  } catch {
    // Unreadable cache -- just recompute.
  }

  const topics = await extractTopics(file);

  try {
    await setSetting(cacheKey, JSON.stringify(topics));
  } catch {
    // Cache write failed -- not fatal.
  }

  return topics;
}