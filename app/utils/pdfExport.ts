'use client';

import { PDFDocument, rgb } from 'pdf-lib';
import { StoredAnnotationItem } from '@/app/utils/db';

function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return { r, g, b };
}

// Annotation coordinates are stored full-page-relative, top-down (y=0 at
// the top of the page), in units that equal PDF points 1:1. PDF's own
// coordinate system is bottom-up, so converting is a single flip per
// point -- no crop offset to account for, since annotations are no longer
// crop-relative at the storage layer.
export async function exportAnnotatedPdf(
  originalFile: File,
  annotationsByPage: Record<number, StoredAnnotationItem[]>
): Promise<Blob> {
  const arrayBuffer = await originalFile.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer);

  for (const [pageNumStr, items] of Object.entries(annotationsByPage)) {
    if (!items || items.length === 0) continue;
    const pageNum = parseInt(pageNumStr, 10);
    const pageIndex = pageNum - 1; // pdf-lib is 0-indexed; our pageNum is 1-indexed
    if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue;

    const page = pdfDoc.getPage(pageIndex);
    const pageHeight = page.getHeight();

    for (const item of items) {
      const { r, g, b } = hexToRgb01(item.color);

      if (item.type === 'stroke') {
        for (let i = 0; i < item.points.length - 1; i++) {
          const p1 = item.points[i];
          const p2 = item.points[i + 1];
          page.drawLine({
            start: { x: p1.x, y: pageHeight - p1.y },
            end: { x: p2.x, y: pageHeight - p2.y },
            thickness: item.width,
            color: rgb(r, g, b),
          });
        }
      } else if (item.type === 'text') {
        // drawText's y is the baseline; our stored y is the top of the
        // text (matching the "hanging" baseline used on screen) --
        // shifting down by roughly one font-size approximates this.
        page.drawText(item.text, {
          x: item.x,
          y: pageHeight - item.y - item.fontSize,
          size: item.fontSize,
          color: rgb(r, g, b),
        });
      }
    }
  }

  const outBytes = await pdfDoc.save();
  return new Blob([new Uint8Array(outBytes)], { type: 'application/pdf' });
}
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}