'use client';

import { requestTopicOutlineFromDigest } from '@/app/utils/geminiClient';
import {
  buildOutlineDigest,
  topicsFromOutlineEntries,
  aiTopicsCacheKey,
  Topic,
} from '@/app/utils/pdfParser';
import { setSetting } from '@/app/utils/db';

// Hard ceiling for the whole operation, so the UI can never spin forever.
const OVERALL_TIMEOUT_MS = 150_000;

// Builds this book's topics with Gemini from extracted text (the PDF itself
// is not uploaded), verifies them against the real page text, and saves them
// for this book so it only ever runs once.
export async function generateTopicsWithAI(
  bookId: string,
  file: File,
  apiKey: string,
  onProgress?: (stage: string) => void
): Promise<Topic[]> {
  let stage = 'starting';
  const setStage = (next: string) => {
    stage = next;
    onProgress?.(next);
  };

  const work = (async () => {
    setStage('Reading the text of the book…');
    const digest = await buildOutlineDigest(file);

    setStage('Asking Gemini for the table of contents…');
    const outline = await requestTopicOutlineFromDigest({ apiKey, digest: digest.text });

    setStage('Checking the outline against the pages…');
    const topics = await topicsFromOutlineEntries(file, outline);
    if (topics.length < 2) {
      throw new Error('The AI could not find a usable outline in this document.');
    }

    await setSetting(aiTopicsCacheKey(bookId), JSON.stringify(topics));
    return topics;
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out while: ${stage}`)), OVERALL_TIMEOUT_MS);
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}