import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface StoredBook {
  id: string;
  title: string;
  fileBlob: Blob;
  uploadedAt: number;
}

export interface StoredProgress {
  bookId: string;
  completedSectionKeys: string[];
  totalSections: number;
  lastReadSectionKey?: string;
}

export interface StoredNote {
  sectionKey: string;
  bookId: string;
  text: string;
  updatedAt: number;
}

interface ReadExDB extends DBSchema {
  books: { key: string; value: StoredBook };
  progress: { key: string; value: StoredProgress };
  notes: { key: string; value: StoredNote; indexes: { bookId: string } };
}

let dbPromise: Promise<IDBPDatabase<ReadExDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<ReadExDB>('readex-db', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('books')) {
          db.createObjectStore('books', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('progress')) {
          db.createObjectStore('progress', { keyPath: 'bookId' });
        }
        if (!db.objectStoreNames.contains('notes')) {
          const store = db.createObjectStore('notes', { keyPath: 'sectionKey' });
          store.createIndex('bookId', 'bookId');
        }
      },
    });
  }
  return dbPromise;
}

export async function saveBook(book: StoredBook): Promise<void> {
  const db = await getDB();
  await db.put('books', book);
}

export async function getAllBooks(): Promise<StoredBook[]> {
  const db = await getDB();
  const books = await db.getAll('books');
  return books.sort((a, b) => b.uploadedAt - a.uploadedAt);
}

export async function getBook(id: string): Promise<StoredBook | undefined> {
  const db = await getDB();
  return db.get('books', id);
}

export async function deleteBook(bookId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['books', 'progress', 'notes'], 'readwrite');

  await tx.objectStore('books').delete(bookId);
  await tx.objectStore('progress').delete(bookId);

  const noteIndex = tx.objectStore('notes').index('bookId');
  let cursor = await noteIndex.openCursor(IDBKeyRange.only(bookId));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }

  await tx.done;
}

export async function saveProgress(progress: StoredProgress): Promise<void> {
  const db = await getDB();
  await db.put('progress', progress);
}

export async function getProgress(bookId: string): Promise<StoredProgress | undefined> {
  const db = await getDB();
  return db.get('progress', bookId);
}

export async function saveNote(note: StoredNote): Promise<void> {
  const db = await getDB();
  await db.put('notes', note);
}

export async function getNotesForBook(bookId: string): Promise<StoredNote[]> {
  const db = await getDB();
  return db.getAllFromIndex('notes', 'bookId', bookId);
}

export function makeSectionKey(bookId: string, index: number, title: string): string {
  return `${bookId}::${index}::${title.slice(0, 40)}`;
}

export function generateBookId(): string {
  return `book_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}