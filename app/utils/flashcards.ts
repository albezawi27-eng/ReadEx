'use client';

import { getAllBooks, getAllNoteRecords } from '@/app/utils/db';

// Anki imports tab-separated text natively (File > Import), front<TAB>back
// per line. Newlines within a note would otherwise be misread as a new
// card, so they're converted to <br> -- import with "Allow HTML in
// fields" checked in Anki's import dialog for those to render correctly.
export async function exportNotesAsFlashcards(): Promise<Blob> {
  const books = await getAllBooks();
  const notes = await getAllNoteRecords();
  const bookTitleById = new Map(books.map((b) => [b.id, b.title]));

  const lines = notes
    .filter((n) => n.text.trim().length > 0)
    .map((note) => {
      const bookTitle = bookTitleById.get(note.bookId) ?? 'Unknown Book';
      const parts = note.sectionKey.split('::');
      const sectionTitle = parts.length >= 3 ? parts.slice(2).join('::') : 'Section';

      const front = `${bookTitle} — ${sectionTitle}`.replace(/\t/g, ' ');
      const back = note.text.replace(/\t/g, '  ').replace(/\r?\n/g, '<br>');

      return `${front}\t${back}`;
    });

  return new Blob([lines.join('\n')], { type: 'text/plain' });
}