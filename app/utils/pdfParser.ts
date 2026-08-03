'use client';

// Try to import from installed package first, fall back to CDN
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).pdfjsLib) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

const STRONG_SECTION_KEYWORDS = /^(abstract|introduction|conclusion|conclusions|references|bibliography|appendix|acknowledgments?|acknowledgements?|discussion|methodology|methods|results?|summary|background|related\s*work|future\s*work|overview|motivation)\s*[:.]?$/i;

// A TOP-LEVEL numbered heading: "3", "3 Something", "Chapter 2", "IV.", "Section 5"
// -- explicitly NOT dotted ("3.2"), which is a subsection.
const TOP_LEVEL_NUMBERED_HEADING = /^(?:Chapter\s+\d+|Section\s+\d+|Appendix\s+[A-Z\d]+|[IVXLC]+\.\s+[A-Z]|\d+\s+[A-Z])[a-zA-Z0-9\s:,\-]*$/;

// A dotted/nested heading: "3.2", "3.2.1 Something", "A.1 Something"
const SUBSECTION_NUMBERED_HEADING = /^(?:\d+(?:\.\d+)+|[A-Z]\.\d+)\s*[a-zA-Z0-9\s:,\-]*$/;

// Metadata / front-matter noise: dates, affiliations, emails, ORCID-style IDs,
// page-number-only lines, running headers/footers.
const METADATA_LINE_PATTERNS = [
  /^(?:\d{1,2}[\/\-.\s])?(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2},?\s*\d{2,4}$/i, // "March 3, 2024"
  /^\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i,
  /^\d{4}-\d{2}-\d{2}$/, // ISO date
  /^(?:Department|Faculty|School|Institute|University|College)\s+of\b/i,
  /^[\w.+-]+@[\w-]+\.[\w.-]+$/, // bare email
  /orcid\.org|\borcid\b/i,
  /^(?:draft|preprint|working paper|version)\b/i,
  /^page\s+\d+(\s+of\s+\d+)?$/i,
  /^\d+$/, // bare page number
  /^(?:arXiv|doi):/i,
];

function isMetadataLine(text: string): boolean {
  return METADATA_LINE_PATTERNS.some((re) => re.test(text));
}

export async function extractPDFText(file: File): Promise<PDFSection[]> {
  try {
    const pdfjsLib = await loadPDFJS();

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allItems: any[] = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      for (const item of textContent.items) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const textItem = item as any;
        if (typeof textItem.str === 'string' && textItem.str.trim() !== '') {
          allItems.push({
            str: textItem.str,
            fontSize: Math.abs(textItem.transform[3]),
            x: textItem.transform[4],
            y: textItem.transform[5],
            pageNum: pageNum,
          });
        }
      }
    }

    if (allItems.length === 0) {
      throw new Error('No text content found in PDF. The PDF may be image-based or encrypted.');
    }

    allItems.sort((a, b) => {
      if (a.pageNum !== b.pageNum) return a.pageNum - b.pageNum;
      const yDiff = b.y - a.y;
      if (Math.abs(yDiff) > 5) {
        return yDiff;
      }
      return a.x - b.x;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lines: any[] = [];
    let currentLineItems = [allItems[0]];

    for (let i = 1; i < allItems.length; i++) {
      const item = allItems[i];
      const firstItemInLine = currentLineItems[0];

      if (item.pageNum === firstItemInLine.pageNum && Math.abs(item.y - firstItemInLine.y) < 8) {
        currentLineItems.push(item);
      } else {
        currentLineItems.sort((a, b) => a.x - b.x);

        let lineText = currentLineItems[0].str;
        for (let j = 1; j < currentLineItems.length; j++) {
          const curr = currentLineItems[j];
          const prev = currentLineItems[j - 1];
          const estimatedPrevWidth = prev.str.length * (prev.fontSize * 0.5);
          if (curr.x - (prev.x + estimatedPrevWidth) > prev.fontSize * 0.2 && !prev.str.endsWith(' ') && !curr.str.startsWith(' ')) {
            lineText += ' ';
          }
          lineText += curr.str;
        }

        lines.push({
          text: lineText.replace(/\s+/g, ' '),
          maxFontSize: Math.max(...currentLineItems.map(x => x.fontSize)),
          y: firstItemInLine.y, // Baseline Y of the line
          pageNum: firstItemInLine.pageNum,
        });
        currentLineItems = [item];
      }
    }

    if (currentLineItems.length > 0) {
      currentLineItems.sort((a, b) => a.x - b.x);
      let lineText = currentLineItems[0].str;
      for (let j = 1; j < currentLineItems.length; j++) {
        const curr = currentLineItems[j];
        const prev = currentLineItems[j - 1];
        const estimatedPrevWidth = prev.str.length * (prev.fontSize * 0.5);
        if (curr.x - (prev.x + estimatedPrevWidth) > prev.fontSize * 0.2 && !prev.str.endsWith(' ') && !curr.str.startsWith(' ')) {
          lineText += ' ';
        }
        lineText += curr.str;
      }
      lines.push({
        text: lineText.replace(/\s+/g, ' '),
        maxFontSize: Math.max(...currentLineItems.map(x => x.fontSize)),
        y: currentLineItems[0].y,
        pageNum: currentLineItems[0].pageNum,
      });
    }

    // --- Determine body font size from the most frequent line height ---
    const sizeFrequencies = new Map<number, number>();
    for (const line of lines) {
      const roundedSize = Math.round(line.maxFontSize);
      sizeFrequencies.set(roundedSize, (sizeFrequencies.get(roundedSize) || 0) + 1);
    }

    let bodyFontSize = 0;
    let maxFreq = 0;
    for (const [size, freq] of sizeFrequencies.entries()) {
      if (freq > maxFreq) {
        maxFreq = freq;
        bodyFontSize = size;
      }
    }

    // --- Section accumulation state ---
    let sections: PDFSection[] = [];
    let currentSectionTitle = 'Document Start';
    let currentSectionContent = '';
    let sectionCounter = 1;
    let currentCrops: PageCrop[] = [];
    let foundFirstHeading = false; // suppress title-page content until real body starts

    const flushSection = () => {
      if (currentCrops.length > 0) {
        sections.push({
          id: sectionCounter++,
          title: currentSectionTitle.length > 40 ? currentSectionTitle.substring(0, 40) + '...' : currentSectionTitle,
          content: currentSectionContent.trim(),
          crops: [...currentCrops],
        });
      }
      currentSectionContent = '';
      currentCrops = [];
    };

    const extendCrop = (line: { pageNum: number; y: number; maxFontSize: number }) => {
      if (currentCrops.length === 0) {
        currentCrops.push({
          pageNum: line.pageNum,
          pdfStartY: line.y + line.maxFontSize,
          pdfEndY: line.y - line.maxFontSize,
        });
      } else {
        const lastCrop = currentCrops[currentCrops.length - 1];
        if (lastCrop.pageNum === line.pageNum) {
          lastCrop.pdfEndY = Math.min(lastCrop.pdfEndY, line.y - line.maxFontSize);
          lastCrop.pdfStartY = Math.max(lastCrop.pdfStartY, line.y + line.maxFontSize);
        } else {
          currentCrops.push({
            pageNum: line.pageNum,
            pdfStartY: line.y + line.maxFontSize,
            pdfEndY: line.y - line.maxFontSize,
          });
        }
      }
    };

    // --- Walk lines, classify top-level headings vs. subsection headings vs. body content ---
    for (const line of lines) {
      const trimmedText = line.text.trim();
      if (!trimmedText) continue;

      // Skip title-page / metadata noise (title, authors, dates, affiliations, IDs)
      // wherever it appears -- and unconditionally before the first real heading,
      // since that's where it lives.
      if (isMetadataLine(trimmedText)) continue;

      const fontRatio = bodyFontSize > 0 ? line.maxFontSize / bodyFontSize : 1;
      const isLargerFont = fontRatio > 1.15;
      const isMuchLargerFont = fontRatio > 1.3;

      const wordCount = trimmedText.split(/\s+/).filter(Boolean).length;
      const isShort = trimmedText.length > 2 && trimmedText.length < 80;

      const hasMathSymbols = /[=+\-*/<>\u0370-\u03FF\u2070-\u209F\u2100-\u214F\u2190-\u21FF\u2200-\u22FF\u27C0-\u27EF\u2980-\u29FF\u2A00-\u2AFF\u20D0-\u20FF\u00B1\u00D7\u00F7\u00B2\u00B3\u00B9\u{1D400}-\u{1D7FF}\uE000-\uF8FF]/u.test(trimmedText);

      const isStrongKeywordHeading = STRONG_SECTION_KEYWORDS.test(trimmedText);
      const isExplicitChapterOrSection = /^(?:Chapter|Section|Appendix)\s+\d+/i.test(trimmedText);
      const isPureTextHeading = /^([A-Z][a-zA-Z0-9\s:,\-]*)$/.test(trimmedText);
      const isSubsectionHeading = isShort && !hasMathSymbols && SUBSECTION_NUMBERED_HEADING.test(trimmedText);
      const isTopLevelNumberedHeading = isShort && !hasMathSymbols && TOP_LEVEL_NUMBERED_HEADING.test(trimmedText);

      const isTopLevelHeading =
        !foundFirstHeading === false && // placeholder no-op kept out; real gating below
        isShort &&
        !hasMathSymbols &&
        !isSubsectionHeading &&
        (
          isStrongKeywordHeading ||
          isExplicitChapterOrSection ||
          (isTopLevelNumberedHeading && isLargerFont) ||
          (isPureTextHeading && isLargerFont && (wordCount >= 2 || isMuchLargerFont))
        );

      // Suppress everything (title, authors, abstract-page furniture that
      // didn't match a metadata pattern) until the first real heading fires.
      if (!foundFirstHeading && !isTopLevelHeading) {
        continue;
      }

      if (isTopLevelHeading) {
        foundFirstHeading = true;
        flushSection();
        currentSectionTitle = trimmedText;
        extendCrop(line);
      } else if (isSubsectionHeading) {
        // Fold subsection headings into the current section's content
        // instead of starting a new sidebar entry.
        currentSectionContent += '\n' + trimmedText + '\n';
        extendCrop(line);
      } else {
        currentSectionContent += trimmedText + '\n';
        extendCrop(line);
      }
    }
    flushSection();

    // Fallback if no sections were detected
    if (sections.length <= 1 && pdf.numPages > 1) {
      sections = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        let minY = Number.MAX_VALUE;
        let maxY = Number.MIN_VALUE;
        for (const line of lines) {
          if (line.pageNum === p) {
            minY = Math.min(minY, line.y - line.maxFontSize);
            maxY = Math.max(maxY, line.y + line.maxFontSize);
          }
        }

        sections.push({
          id: p,
          title: `Page ${p}`,
          content: '',
          crops: [{
            pageNum: p,
            pdfStartY: maxY === Number.MIN_VALUE ? 800 : maxY,
            pdfEndY: minY === Number.MAX_VALUE ? 0 : minY,
          }],
        });
      }
    }

    return sections;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new Error(`Failed to extract PDF: ${errorMessage}`);
  }
}