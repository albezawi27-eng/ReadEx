'use client';

import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { getAllBooks, getAllNoteRecords, getBook, StoredNote } from '@/app/utils/db';
import { extractPDFText } from '@/app/utils/pdfParser';

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const CARD_PADDING = 14;
const CARD_GAP = 16;
const CITATION_SIZE = 9;
const BODY_SIZE = 12;
const CITATION_LINE_HEIGHT = 12;
const BODY_LINE_HEIGHT = 16;

function parseSectionKey(sectionKey: string): { bookId: string; index: number } | null {
  const parts = sectionKey.split('::');
  if (parts.length < 2) return null;
  const bookId = parts[0];
  const index = parseInt(parts[1], 10);
  if (Number.isNaN(index)) return null;
  return { bookId, index };
}

// Manual word-wrap -- pdf-lib has no layout engine, so this measures each
// candidate line's rendered width and breaks before it would overflow.
// Explicit newlines in the note are preserved as their own paragraphs
// rather than being collapsed into the wrap.
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }
    const words = paragraph.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const width = font.widthOfTextAtSize(testLine, size);
      if (width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
  }

  return lines;
}

interface ResolvedNote {
  bookTitle: string;
  sectionTitle: string;
  pageNum: number | null;
  text: string;
}

async function renderFlashcardPdf(notes: ResolvedNote[]): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  page.drawText('ReadEx Flashcards', {
    x: MARGIN,
    y,
    size: 20,
    font: boldFont,
    color: rgb(0.1, 0.1, 0.1),
  });
  y -= 22;
  page.drawText(new Date().toLocaleDateString(), {
    x: MARGIN,
    y,
    size: 10,
    font: bodyFont,
    color: rgb(0.5, 0.5, 0.5),
  });
  y -= 30;

  const startNewPage = () => {
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };

  for (const note of notes) {
    const citation = note.pageNum
      ? `${note.bookTitle} — ${note.sectionTitle} (p. ${note.pageNum})`
      : `${note.bookTitle} — ${note.sectionTitle}`;

    const citationLines = wrapText(citation, boldFont, CITATION_SIZE, CONTENT_WIDTH - CARD_PADDING * 2);
    const bodyLines = wrapText(note.text, bodyFont, BODY_SIZE, CONTENT_WIDTH - CARD_PADDING * 2);

    const cardHeight =
      CARD_PADDING * 2 + citationLines.length * CITATION_LINE_HEIGHT + 6 + bodyLines.length * BODY_LINE_HEIGHT;

    if (y - cardHeight < MARGIN) {
      startNewPage();
    }

    const cardTop = y;
    const cardBottom = y - cardHeight;

    page.drawRectangle({
      x: MARGIN,
      y: cardBottom,
      width: CONTENT_WIDTH,
      height: cardHeight,
      borderColor: rgb(0.75, 0.75, 0.78),
      borderWidth: 1,
      color: rgb(0.98, 0.98, 0.99),
    });

    let textY = cardTop - CARD_PADDING - CITATION_SIZE;
    for (const line of citationLines) {
      page.drawText(line, {
        x: MARGIN + CARD_PADDING,
        y: textY,
        size: CITATION_SIZE,
        font: boldFont,
        color: rgb(0.25, 0.35, 0.55),
      });
      textY -= CITATION_LINE_HEIGHT;
    }

    textY -= 6;
    for (const line of bodyLines) {
      page.drawText(line, {
        x: MARGIN + CARD_PADDING,
        y: textY,
        size: BODY_SIZE,
        font: bodyFont,
        color: rgb(0.15, 0.15, 0.15),
      });
      textY -= BODY_LINE_HEIGHT;
    }

    y = cardBottom - CARD_GAP;
  }

  const outBytes = await pdfDoc.save();
  return new Blob([new Uint8Array(outBytes)], { type: 'application/pdf' });
}

export async function exportNotesAsFlashcardPdf(): Promise<Blob> {
  const books = await getAllBooks();
  const notes = await getAllNoteRecords();
  const bookTitleById = new Map(books.map((b) => [b.id, b.title]));

  const notesWithText = notes.filter((n) => n.text.trim().length > 0);
  if (notesWithText.length === 0) {
    throw new Error('No notes to export yet.');
  }

  const notesByBook = new Map<string, StoredNote[]>();
  for (const note of notesWithText) {
    if (!notesByBook.has(note.bookId)) notesByBook.set(note.bookId, []);
    notesByBook.get(note.bookId)!.push(note);
  }

  const resolved: ResolvedNote[] = [];

  for (const [bookId, bookNotes] of notesByBook.entries()) {
    const bookTitle = bookTitleById.get(bookId) ?? 'Unknown Book';
    const stored = await getBook(bookId);

    let sectionsInfo: { title: string; pageNum: number | null }[] = [];
    if (stored) {
      try {
        const file = new File([stored.fileBlob], stored.title, { type: 'application/pdf' });
        const sections = await extractPDFText(file);
        sectionsInfo = sections.map((s) => ({
          title: s.title,
          pageNum: s.crops?.[0]?.pageNum ?? null,
        }));
      } catch (err) {
        console.warn(`Could not re-extract sections for book ${bookId}:`, err);
      }
    }

    for (const note of bookNotes) {
      const parsed = parseSectionKey(note.sectionKey);
      const info = parsed && sectionsInfo[parsed.index] ? sectionsInfo[parsed.index] : null;
      resolved.push({
        bookTitle,
        sectionTitle: info?.title ?? 'Section',
        pageNum: info?.pageNum ?? null,
        text: note.text.trim(),
      });
    }
  }

  return renderFlashcardPdf(resolved);
}