'use client';

import JSZip from 'jszip';
import {
  getAllBooks,
  saveBook,
  getAllProgressRecords,
  saveProgress,
  getAllNoteRecords,
  saveNote,
  getAllAnnotationRecords,
  savePageAnnotations,
  getAllChatRecords,
  saveChat,
  getAllSettingRecords,
  setSetting,
} from '@/app/utils/db';

const BACKUP_VERSION = 1;

export async function exportLibrary(): Promise<Blob> {
  const zip = new JSZip();

  const books = await getAllBooks();
  const progress = await getAllProgressRecords();
  const notes = await getAllNoteRecords();
  const annotations = await getAllAnnotationRecords();
  const chats = await getAllChatRecords();
  const settings = await getAllSettingRecords();

  const manifest = {
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    books: books.map((b) => ({ id: b.id, title: b.title, uploadedAt: b.uploadedAt })),
    progress,
    notes,
    annotations,
    chats,
    settings,
  };

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  const booksFolder = zip.folder('books');
  for (const book of books) {
    booksFolder?.file(`${book.id}.pdf`, book.fileBlob);
  }

  return zip.generateAsync({ type: 'blob' });
}

export async function importLibrary(file: File): Promise<{ booksImported: number }> {
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    throw new Error('This does not look like a ReadEx backup file (no manifest.json found).');
  }

  const manifestText = await manifestFile.async('text');
  const manifest = JSON.parse(manifestText);

  let booksImported = 0;
  for (const bookMeta of manifest.books ?? []) {
    const pdfEntry = zip.file(`books/${bookMeta.id}.pdf`);
    if (!pdfEntry) continue;
    const blob = await pdfEntry.async('blob');
    await saveBook({
      id: bookMeta.id,
      title: bookMeta.title,
      uploadedAt: bookMeta.uploadedAt,
      fileBlob: blob,
    });
    booksImported++;
  }

  for (const p of manifest.progress ?? []) await saveProgress(p);
  for (const n of manifest.notes ?? []) await saveNote(n);
  for (const a of manifest.annotations ?? []) await savePageAnnotations(a);
  for (const c of manifest.chats ?? []) await saveChat(c);
  for (const s of manifest.settings ?? []) await setSetting(s.key, s.value);

  return { booksImported };
}