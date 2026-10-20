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

// One sidebar entry per page, sized from each page's real dimensions.
// No text analysis at all, so this works identically for normal and
// scanned PDFs, and is much faster than reading every line of text.
// (Function name kept so existing imports don't need to change.)
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