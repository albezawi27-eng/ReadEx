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

// A topic is a run of consecutive pages (a part, chapter, section...).
// Topics nest: children cover sub-ranges of their parent's pages.
export interface Topic {
  title: string;
  startPage: number;
  endPage: number;
  children: Topic[];
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
// Topics (layered)
// ---------------------------------------------------------------------------

// Deepest nesting shown in the sidebar (levels, not counting pages).
const MAX_TOPIC_LEVELS = 4;

// A heading found in the document, in reading order. depth 0 is the top level.
interface RawEntry {
  title: string;
  startPage: number;
  depth: number;
}

interface DraftNode {
  title: string;
  startPage: number;
  children: DraftNode[];
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

// Flattens the bookmark tree into reading-order entries that keep their depth.
// A grouping bookmark with no destination of its own borrows the page of its
// first child, so it still appears as a parent topic.
async function flattenOutline(pdf: any, items: any[], depth: number, out: RawEntry[]): Promise<void> {
  for (const item of items) {
    const title = String(item.title ?? '').replace(/\s+/g, ' ').trim();
    let page: number | null = item.dest ? await resolveDestPage(pdf, item.dest) : null;

    const childEntries: RawEntry[] = [];
    if (Array.isArray(item.items) && item.items.length > 0) {
      await flattenOutline(pdf, item.items, depth + 1, childEntries);
    }

    if ((page === null || page < 1 || page > pdf.numPages) && childEntries.length > 0) {
      page = childEntries[0].startPage;
    }

    if (title && page !== null && page >= 1 && page <= pdf.numPages) {
      out.push({ title, startPage: page, depth });
    }
    for (const child of childEntries) out.push(child);
  }
}

// Turns reading-order entries into a tree. Tolerates gaps in depth (for
// example a child whose parent bookmark was dropped).
function entriesToDraft(entries: RawEntry[]): DraftNode[] {
  const roots: DraftNode[] = [];
  const stack: { depth: number; node: DraftNode }[] = [];

  for (const entry of entries) {
    const node: DraftNode = { title: entry.title, startPage: entry.startPage, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].depth >= entry.depth) stack.pop();
    if (stack.length > 0) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ depth: entry.depth, node });
  }

  return roots;
}

// Gives every node its page range. A node ends where its next sibling starts
// (or at the end of its parent), children are clamped inside their parent,
// and siblings that start on the same page are merged.
function finalizeLevel(nodes: DraftNode[], rangeStart: number, rangeEnd: number, level: number): Topic[] {
  const clamped: DraftNode[] = [];
  for (const node of nodes) {
    const start = Math.max(node.startPage, rangeStart);
    if (start > rangeEnd) continue;
    clamped.push({ title: node.title, startPage: start, children: node.children });
  }
  clamped.sort((a, b) => a.startPage - b.startPage);

  const merged: DraftNode[] = [];
  for (const node of clamped) {
    const last = merged[merged.length - 1];
    if (last && last.startPage === node.startPage) {
      last.children = last.children.concat(node.children);
    } else {
      merged.push({ title: node.title, startPage: node.startPage, children: node.children.slice() });
    }
  }

  const result: Topic[] = [];
  merged.forEach((node, i) => {
    const next = merged[i + 1];
    const endPage = next ? Math.max(node.startPage, next.startPage - 1) : rangeEnd;
    const children =
      level + 1 < MAX_TOPIC_LEVELS && node.children.length > 0
        ? finalizeLevel(node.children, node.startPage, endPage, level + 1)
        : [];
    result.push({
      title: node.title.length > 80 ? node.title.slice(0, 80) + '…' : node.title,
      startPage: node.startPage,
      endPage,
      children,
    });
  });
  return result;
}

// A book wrapped in one big "title" bookmark would otherwise show a single
// topic containing everything -- open it up and show its contents instead.
function unwrapSingleRoot(topics: Topic[]): Topic[] {
  let current = topics;
  while (current.length === 1 && current[0].children.length >= 2) {
    current = current[0].children;
  }
  return current;
}

const STRONG_SECTION_KEYWORDS =
  /^(abstract|introduction|conclusions?|references|bibliography|appendix|acknowledg(?:e)?ments?|discussion|methodology|methods|results?|summary|background|related\s*work|future\s*work|overview|motivation|preface|foreword|contents|glossary)\s*[:.]?$/i;
const EXPLICIT_CHAPTER = /^(?:Chapter|Section|Part|Appendix)\s+[\dIVXLC]+/i;
const TOP_LEVEL_NUMBERED_HEADING =
  /^(?:[IVXLC]+\.\s+[A-Z]|\d+\.?\s+[A-Z])[a-zA-Z0-9\s:,\-]*$/;
// Any dotted numbering: "3.2", "3.2.1 Title", "A.1 Title"
const SUBSECTION_NUMBERED_HEADING = /^(?:\d+(?:\.\d+)+|[A-Z]\.\d+)\s*[a-zA-Z0-9\s:,\-]*$/;
// A real two-level subheading with a title: "2.1 Background"
const NUMBERED_SUBHEADING = /^\d+\.\d+\.?\s+[A-Z][A-Za-z0-9\s:,\-]{2,}$/;
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

// Fallback for PDFs with no bookmarks. Finds chapter-level headings by their
// wording and font size, and two-level numbered subheadings ("2.1 Title").
// Deliberately strict -- better to find nothing than to fill the sidebar
// with noise.
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
  const pagesWithSub = new Set<number>();

  for (const line of lines) {
    const text = line.text.trim();
    if (text.length < 3 || text.length >= 80) continue;
    if (isMetadataLine(text)) continue;
    if ((pagesByText.get(text.toLowerCase())?.size ?? 0) >= 3) continue;
    if (MATH_SYMBOLS.test(text)) continue;

    const ratio = bodySize > 0 ? line.fontSize / bodySize : 1;
    const words = text.split(/\s+/).filter(Boolean).length;

    // Dotted numbering is a sub-level heading (or an equation/figure number).
    if (SUBSECTION_NUMBERED_HEADING.test(text)) {
      if (
        NUMBERED_SUBHEADING.test(text) &&
        ratio > 1.05 &&
        words <= 12 &&
        !pagesWithSub.has(line.pageNum)
      ) {
        entries.push({ title: text, startPage: line.pageNum, depth: 1 });
        pagesWithSub.add(line.pageNum);
      }
      continue;
    }

    if (pagesWithTopic.has(line.pageNum)) continue;

    const larger = ratio > 1.15;
    const muchLarger = ratio > 1.3;

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
  const top = entries.filter((e) => e.depth === 0);
  if (top.length > 8 && top.length > pdf.numPages * 0.5) return [];

  const sub = entries.filter((e) => e.depth === 1);
  if (sub.length > pdf.numPages) return top;

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
        await flattenOutline(pdf, outline, 0, entries);
      }
    } catch (err) {
      console.warn('Could not read PDF bookmarks:', err);
    }

    if (new Set(entries.map((e) => e.startPage)).size < 2) {
      entries = await detectTopicsByHeadings(pdf);
    }

    let topics = unwrapSingleRoot(finalizeLevel(entriesToDraft(entries), 1, pdf.numPages, 0));
    if (topics.length < 2) return [];

    if (topics[0].startPage > 1) {
      topics = [
        { title: 'Front matter', startPage: 1, endPage: topics[0].startPage - 1, children: [] },
        ...topics,
      ];
    }

    return topics;
  } catch (err) {
    // Topics are a convenience -- never let them break opening a book.
    console.warn('Topic detection failed:', err);
    return [];
  }
}

// Topics only depend on the file, so they're computed once per book and cached.
// Bump the version in the key if the detection logic or shape ever changes
// (v2 = layered topics with children).
export async function loadTopicsForBook(bookId: string, file: File): Promise<Topic[]> {
  const cacheKey = `topics-v2:${bookId}`;

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