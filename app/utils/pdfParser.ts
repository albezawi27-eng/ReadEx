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

// One heading as returned by the AI outline: level 1 = chapter, 2 = section...
export interface OutlineEntryInput {
  title: string;
  page: number;
  level: number;
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

// Entries (in reading order, with depths) -> finished topic tree.
function assembleTopics(entries: RawEntry[], numPages: number): Topic[] {
  let topics = unwrapSingleRoot(finalizeLevel(entriesToDraft(entries), 1, numPages, 0));
  if (topics.length < 2) return [];

  if (topics[0].startPage > 1) {
    topics = [
      { title: 'Front matter', startPage: 1, endPage: topics[0].startPage - 1, children: [] },
      ...topics,
    ];
  }

  return topics;
}

// How deep a heading sits, judging only by how it is numbered or labelled:
// "Chapter 3" / "Part II" -> 0, "2" -> 0, "2.1" -> 1, "2.1.3" -> 2.
// Returns null when the text carries no numbering at all.
function numberingDepth(text: string): number | null {
  const t = text.trim();
  if (/^(?:Chapter|CHAPTER|Part|PART)\s+[\dIVXLC]+(?:\s*[:.\-–—]\s*\S.*|\s*)$/.test(t)) return 0;
  if (/^(?:Appendix|APPENDIX)(?:\s+[A-Z\d]+)?(?:\s*[:.\-–—]\s*\S.*|\s*)$/.test(t)) return 0;
  if (/^(?:Section|SECTION)\s+[\d.]+(?:\s*[:.\-–—]\s*\S.*|\s*)$/.test(t)) return 1;
  const dotted = t.match(/^(\d+(?:\.\d+){0,3})\.?\s+\S/);
  if (dotted) return Math.min(3, dotted[1].split('.').length - 1);
  if (/^[IVXLC]+\.\s+\S/.test(t)) return 0;
  return null;
}

// Some PDFs have flat bookmarks ("1", "1.1", "1.2", "2"...). When most titles
// are numbered, rebuild the nesting from the numbering.
function deriveDepthFromNumbering(entries: RawEntry[]): RawEntry[] {
  if (entries.length < 4 || !entries.every((e) => e.depth === 0)) return entries;
  const depths = entries.map((e) => numberingDepth(e.title));
  const numbered = depths.filter((d) => d !== null).length;
  if (numbered < entries.length * 0.5 || !depths.some((d) => d !== null && d > 0)) return entries;
  return entries.map((e, i) => ({ ...e, depth: depths[i] ?? 0 }));
}

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

// Figure and table labels look like headings but aren't.
const FIGURE_LABEL = /^(?:Figure|Fig\.|Table|Exhibit|Listing|Equation|Algorithm)\s*\d/i;

// Equation-ish characters. Hyphens and slashes are deliberately NOT here,
// since headings like "Black-Scholes Model" contain them.
const HEADING_MATH =
  /[=<>\u2200-\u22FF\u2190-\u21FF\u00B1\u00D7\u00F7\u{1D400}-\u{1D7FF}\uE000-\uF8FF]/u;

interface Seg {
  str: string;
  size: number;
  font: string;
  x: number;
  width: number;
}

type PlacedSeg = Seg & { y: number };

interface TextLine {
  text: string;
  size: number;     // font size of the dominant text on the line
  font: string;     // font id of the dominant text on the line
  pageNum: number;
  gapAbove: number; // vertical space to the row above (Infinity for the first row)
  yFrac: number;    // 0 = bottom edge of the page, 1 = top edge
}

function joinSegment(items: Seg[]): string {
  let text = items[0].str;
  for (let j = 1; j < items.length; j++) {
    const prev = items[j - 1];
    const curr = items[j];
    const prevWidth = prev.width > 0 ? prev.width : prev.str.length * prev.size * 0.5;
    const gap = curr.x - (prev.x + prevWidth);
    if (gap > prev.size * 0.15 && !prev.str.endsWith(' ') && !curr.str.startsWith(' ')) {
      text += ' ';
    }
    text += curr.str;
  }
  return text.replace(/\s+/g, ' ').trim();
}

// Reads every page into visual lines. A line's size and font come from its
// dominant text, so one oversized glyph (a big bracket, a drop cap) can't
// make an ordinary body line look like a heading.
async function collectLines(pdf: any): Promise<TextLine[]> {
  const lines: TextLine[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const [, viewBottom, , viewTop] = page.view;
    const pageHeight = Math.max(1, viewTop - viewBottom);

    const items: PlacedSeg[] = [];
    for (const raw of content.items as any[]) {
      if (typeof raw.str !== 'string' || raw.str.trim() === '') continue;
      const size = Math.abs(raw.transform[3]) || Math.abs(raw.transform[0]) || raw.height || 0;
      items.push({
        str: raw.str,
        size,
        font: String(raw.fontName ?? ''),
        x: raw.transform[4],
        y: raw.transform[5],
        width: raw.width ?? 0,
      });
    }
    items.sort((a, b) => b.y - a.y || a.x - b.x);

    // Visual rows: items whose baselines sit within a few points of each other.
    const rows: { y: number; items: PlacedSeg[] }[] = [];
    for (const item of items) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(item.y - row.y) < 4) row.items.push(item);
      else rows.push({ y: item.y, items: [item] });
    }

    rows.forEach((row, rowIndex) => {
      const gapAbove = rowIndex === 0 ? Number.POSITIVE_INFINITY : rows[rowIndex - 1].y - row.y;
      row.items.sort((a, b) => a.x - b.x);

      // A row can hold several columns -- split wherever there is a wide gap.
      const segments: PlacedSeg[][] = [];
      let current: PlacedSeg[] = [row.items[0]];
      for (let i = 1; i < row.items.length; i++) {
        const prev = row.items[i - 1];
        const item = row.items[i];
        const gap = item.x - (prev.x + prev.width);
        if (gap > 2.5 * Math.max(prev.size, item.size, 1)) {
          segments.push(current);
          current = [item];
        } else {
          current.push(item);
        }
      }
      segments.push(current);

      for (const seg of segments) {
        const text = joinSegment(seg);
        if (!text) continue;
        let dominant = seg[0];
        for (const s of seg) {
          if (s.str.length > dominant.str.length) dominant = s;
        }
        lines.push({
          text,
          size: dominant.size,
          font: dominant.font,
          pageNum: p,
          gapAbove,
          yFrac: (row.y - viewBottom) / pageHeight,
        });
      }
    });

    page.cleanup?.();
  }

  return lines;
}

function styleKey(line: TextLine): string {
  return `${Math.round(line.size * 2) / 2}|${line.font}`;
}

// Fallback for PDFs with no bookmarks. A line counts as a heading only if it
// is short, looks different from body text, AND its look (font + size) shows
// up on several pages -- real headings are consistent, random body lines are
// one-offs. Better to find nothing than to fill the sidebar with noise.
async function detectTopicsByHeadings(pdf: any): Promise<RawEntry[]> {
  const lines = await collectLines(pdf);
  if (lines.length === 0) return [];
  const numPages: number = pdf.numPages;

  // Body style = the (font, size) carrying the most text.
  const charsByStyle = new Map<string, number>();
  for (const line of lines) {
    const key = styleKey(line);
    charsByStyle.set(key, (charsByStyle.get(key) || 0) + line.text.length);
  }
  let bodyKey = '';
  let bodyChars = 0;
  for (const [key, chars] of charsByStyle.entries()) {
    if (chars > bodyChars) {
      bodyKey = key;
      bodyChars = chars;
    }
  }
  const [bodySizeText, ...fontParts] = bodyKey.split('|');
  const bodySize = parseFloat(bodySizeText) || 0;
  const bodyFont = fontParts.join('|');
  if (bodySize <= 0) return [];

  // Typical spacing between consecutive rows of body text.
  const gaps = lines
    .map((l) => l.gapAbove)
    .filter((g) => Number.isFinite(g) && g > 1 && g < bodySize * 4)
    .sort((a, b) => a - b);
  const pitch = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : bodySize * 1.2;

  // Running headers and footers: the same text in the page margins, again and again.
  const inMargin = (l: TextLine) => l.yFrac > 0.93 || l.yFrac < 0.06;
  const marginKey = (t: string) => t.toLowerCase().replace(/\d+/g, '#').trim();
  const marginPages = new Map<string, Set<number>>();
  for (const line of lines) {
    if (!inMargin(line)) continue;
    const key = marginKey(line.text);
    const set = marginPages.get(key);
    if (set) set.add(line.pageNum);
    else marginPages.set(key, new Set([line.pageNum]));
  }

  interface Candidate {
    line: TextLine;
    key: string;
  }
  const candidates: Candidate[] = [];

  for (const line of lines) {
    const text = line.text;
    if (text.length < 3 || text.length > 90) continue;
    if (/[.,;:]$/.test(text)) continue; // sentences end in punctuation, headings don't
    if (!/^[A-Z0-9]/.test(text)) continue;
    if (text.split(/\s+/).length > 14) continue;
    if (isMetadataLine(text) || FIGURE_LABEL.test(text) || HEADING_MATH.test(text)) continue;
    if (inMargin(line) && (marginPages.get(marginKey(text))?.size ?? 0) >= 3) continue;
    if (line.size < bodySize * 0.95) continue; // footnotes, captions, small print

    const larger = line.size > bodySize * 1.08;
    const differentFont = line.font !== bodyFont;
    if (!larger && !differentFont) continue; // looks exactly like body text
    // Same-size text only counts as a heading if it has extra space above it.
    if (!larger && !(line.gapAbove > pitch * 1.3)) continue;

    candidates.push({ line, key: styleKey(line) });
  }

  // Keep only looks that recur across pages, and aren't so common they must be noise.
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const group = groups.get(c.key);
    if (group) group.push(c);
    else groups.set(c.key, [c]);
  }

  const minPages = numPages < 8 ? 2 : 3;
  const keptStyles: { key: string; size: number }[] = [];
  for (const [key, group] of groups.entries()) {
    const pages = new Set(group.map((c) => c.line.pageNum));
    if (pages.size < minPages) continue;
    if (group.length > Math.max(8, numPages * 0.6)) continue;
    keptStyles.push({ key, size: group[0].line.size });
  }
  if (keptStyles.length === 0) return [];

  // Bigger text = higher level; up to three levels.
  keptStyles.sort((a, b) => b.size - a.size);
  const styleRank = new Map<string, number>(
    keptStyles.slice(0, 3).map((s, i): [string, number] => [s.key, i])
  );

  const entries: RawEntry[] = [];
  for (const c of candidates) {
    const rank = styleRank.get(c.key);
    if (rank === undefined) continue;
    // Numbering ("2.1") is the most reliable sign of depth; font size is the backup.
    const depth = numberingDepth(c.line.text) ?? rank;
    entries.push({ title: c.line.text, startPage: c.line.pageNum, depth });
  }

  // "Chapter 3" and its subtitle on the next line become one title.
  const merged: RawEntry[] = [];
  for (const entry of entries) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.depth === 0 &&
      entry.depth === 0 &&
      prev.startPage === entry.startPage &&
      numberingDepth(prev.title) === 0 &&
      numberingDepth(entry.title) === null &&
      !prev.title.includes(' — ')
    ) {
      prev.title = `${prev.title} — ${entry.title}`;
    } else {
      merged.push({ ...entry });
    }
  }

  if (merged.length < 2) return [];

  // Far too many "headings" means the detection is just picking up noise.
  if (numPages > 10 && merged.length > numPages * 0.8) {
    const top = merged.filter((e) => e.depth === 0);
    return top.length >= 2 && top.length <= numPages * 0.6 ? top : [];
  }

  return merged;
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
        entries = deriveDepthFromNumbering(entries);
      }
    } catch (err) {
      console.warn('Could not read PDF bookmarks:', err);
    }

    if (new Set(entries.map((e) => e.startPage)).size < 2) {
      entries = await detectTopicsByHeadings(pdf);
    }

    return assembleTopics(entries, pdf.numPages);
  } catch (err) {
    // Topics are a convenience -- never let them break opening a book.
    console.warn('Topic detection failed:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// AI outline: turns Gemini's table of contents into verified topics
// ---------------------------------------------------------------------------

export function aiTopicsCacheKey(bookId: string): string {
  return `topics-ai-v1:${bookId}`;
}

const normalizeTitle = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

// The comparable form of a title, without its "Chapter 3" / "2.1" prefix.
function titleKey(title: string): string {
  const stripped = title
    .replace(/^(?:chapter|part|section|appendix)\s+[\w.]+\s*[:.\-–—]?\s*/i, '')
    .replace(/^\d+(?:\.\d+)*\.?\s+/, '');
  return normalizeTitle(stripped || title).slice(0, 60);
}

// Gemini reports page positions, but they are sometimes the number PRINTED on
// the page, which differs from the file position by the length of the front
// matter. This looks for a single constant shift that makes the most titles
// appear on their claimed pages, and applies it only when the evidence is clear.
export async function topicsFromOutlineEntries(file: File, input: OutlineEntryInput[]): Promise<Topic[]> {
  const pdfjsLib = await loadPDFJS();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages: number = pdf.numPages;

  const entries = input
    .map((e) => ({
      title: String(e.title ?? '').replace(/\s+/g, ' ').trim(),
      page: Math.round(Number(e.page)),
      level: Math.round(Number(e.level)),
    }))
    .filter((e) => e.title.length > 0 && Number.isFinite(e.page) && e.page >= 1 && e.level >= 1)
    .slice(0, 500);

  if (entries.length < 2) return [];

  const lines = await collectLines(pdf);
  const keysByPage = new Map<number, string[]>();
  for (const line of lines) {
    if (line.text.length > 120) continue;
    const normalized = normalizeTitle(line.text);
    if (!normalized) continue;
    const list = keysByPage.get(line.pageNum);
    if (list) list.push(normalized);
    else keysByPage.set(line.pageNum, [normalized]);
  }

  const keyed = entries
    .map((e) => ({ entry: e, key: titleKey(e.title) }))
    .filter((x) => x.key.length >= 4);

  const onPage = (page: number, key: string): boolean => {
    const onThisPage = keysByPage.get(page);
    if (!onThisPage) return false;
    return onThisPage.some((c) => c.includes(key) && c.length <= key.length + 18);
  };

  const countAtShift = (shift: number): number => {
    let n = 0;
    for (const x of keyed) {
      if (onPage(x.entry.page + shift, x.key)) n++;
    }
    return n;
  };

  let bestShift = 0;
  if (keyed.length >= 3) {
    const base = countAtShift(0);
    const results: [number, number][] = [];
    for (let s = -40; s <= 80; s++) results.push([s, countAtShift(s)]);
    const max = Math.max(...results.map((r) => r[1]));

    if (max >= 3 && max >= base + 3 && max >= keyed.length * 0.25) {
      // A running header repeats a chapter title across many pages, so the
      // best shifts form a plateau -- its left edge is the true one.
      const threshold = Math.ceil(max * 0.85);
      const winner = results.find((r) => r[1] >= threshold);
      if (winner) bestShift = winner[0];
    }
  }

  const raw: RawEntry[] = entries.map((e) => ({
    title: e.title,
    startPage: Math.min(numPages, Math.max(1, e.page + bestShift)),
    depth: Math.min(e.level - 1, MAX_TOPIC_LEVELS - 1),
  }));

  return assembleTopics(raw, numPages);
}

// Topics only depend on the file, so they're computed once per book and cached.
// An AI-made outline, if the user generated one, always takes priority.
// Bump the version in the key if the detection logic or shape ever changes
// (v3 = recurrence-based heading detection).
export async function loadTopicsForBook(bookId: string, file: File): Promise<Topic[]> {
  try {
    const ai = await getSetting(aiTopicsCacheKey(bookId));
    if (ai) {
      const parsed = JSON.parse(ai) as Topic[];
      if (Array.isArray(parsed) && parsed.length >= 2) return parsed;
    }
  } catch {
    // Unreadable AI cache -- fall through to normal detection.
  }

  const cacheKey = `topics-v3:${bookId}`;

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
// ---------------------------------------------------------------------------
// Text digest for the AI outline -- lets Gemini work from extracted text
// instead of reading (and needing an upload of) the whole PDF
// ---------------------------------------------------------------------------

const DIGEST_FRONT_PAGES = 14;
const DIGEST_CHARS_PER_FRONT_PAGE = 3000;
const DIGEST_MAX_CANDIDATES = 1500;
const DIGEST_MAX_PER_PAGE = 8;

export interface OutlineDigest {
  text: string;
  numPages: number;
}

interface DigestCandidate {
  page: number;
  ratio: number;
  altFont: boolean;
  text: string;
}

export async function buildOutlineDigest(file: File): Promise<OutlineDigest> {
  const pdfjsLib = await loadPDFJS();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages: number = pdf.numPages;

  const lines = await collectLines(pdf);
  if (lines.length === 0) {
    throw new Error('This PDF has no selectable text (it looks scanned), so topics cannot be detected from it.');
  }

  // Body style = the (font, size) carrying the most text.
  const charsByStyle = new Map<string, number>();
  for (const line of lines) {
    const key = styleKey(line);
    charsByStyle.set(key, (charsByStyle.get(key) || 0) + line.text.length);
  }
  let bodyKey = '';
  let bodyChars = 0;
  for (const [key, chars] of charsByStyle.entries()) {
    if (chars > bodyChars) {
      bodyKey = key;
      bodyChars = chars;
    }
  }
  const [bodySizeText, ...fontParts] = bodyKey.split('|');
  const bodySize = parseFloat(bodySizeText) || 1;
  const bodyFont = fontParts.join('|');

  // Running headers and footers: the same text in the page margins, again and again.
  const inMargin = (l: TextLine) => l.yFrac > 0.93 || l.yFrac < 0.06;
  const marginKey = (t: string) => t.toLowerCase().replace(/\d+/g, '#').trim();
  const marginPages = new Map<string, Set<number>>();
  for (const line of lines) {
    if (!inMargin(line)) continue;
    const key = marginKey(line.text);
    const set = marginPages.get(key);
    if (set) set.add(line.pageNum);
    else marginPages.set(key, new Set([line.pageNum]));
  }

  // The first pages in full -- a printed table of contents is usually here.
  const frontParts: string[] = [];
  for (let p = 1; p <= Math.min(numPages, DIGEST_FRONT_PAGES); p++) {
    const pageText = lines
      .filter((l) => l.pageNum === p)
      .map((l) => l.text)
      .join('\n')
      .slice(0, DIGEST_CHARS_PER_FRONT_PAGE);
    if (pageText.trim()) frontParts.push(`--- file page ${p} ---\n${pageText}`);
  }

  // Lines that look different from body text. Deliberately loose: Gemini
  // decides which ones are real headings.
  let candidates: DigestCandidate[] = [];
  const perPage = new Map<number, number>();
  for (const line of lines) {
    const text = line.text;
    if (text.length < 3 || text.length > 100) continue;
    if (/[,;]$/.test(text)) continue;
    if (!/^[A-Z0-9]/.test(text)) continue;
    if (isMetadataLine(text) || FIGURE_LABEL.test(text) || HEADING_MATH.test(text)) continue;
    if (inMargin(line) && (marginPages.get(marginKey(text))?.size ?? 0) >= 3) continue;
    if (line.size < bodySize * 0.95) continue;

    const ratio = line.size / bodySize;
    const altFont = line.font !== bodyFont;
    const looksNumbered = numberingDepth(text) !== null && text.split(/\s+/).length <= 10;
    if (!(ratio > 1.05 || altFont || looksNumbered)) continue;

    const count = perPage.get(line.pageNum) ?? 0;
    if (count >= DIGEST_MAX_PER_PAGE) continue;
    perPage.set(line.pageNum, count + 1);
    candidates.push({ page: line.pageNum, ratio, altFont, text });
  }

  if (candidates.length > DIGEST_MAX_CANDIDATES) {
    const strong = candidates.filter((c) => c.ratio >= 1.15 || numberingDepth(c.text) !== null);
    if (strong.length > 0) candidates = strong;
    if (candidates.length > DIGEST_MAX_CANDIDATES) candidates = candidates.slice(0, DIGEST_MAX_CANDIDATES);
  }

  const candidateLines = candidates.map(
    (c) => `p${c.page} x${c.ratio.toFixed(1)}${c.altFont ? '*' : ''} ${c.text}`
  );

  const text = [
    `This PDF has ${numPages} pages. In the lists below, "p12" means the 12th page of the FILE (the first page of the file is p1), which can differ from the number printed on the page.`,
    '',
    'FIRST PAGES (a printed table of contents, if the book has one, is usually here):',
    frontParts.join('\n\n') || '(no text on the first pages)',
    '',
    'CANDIDATE HEADING LINES -- lines that look different from body text. Format: p<file page> x<size relative to body text>[* = different font] <text>. Many of these are NOT real headings.',
    candidateLines.join('\n') || '(none found)',
  ].join('\n');

  return { text, numPages };
}