'use client';

import { uploadPdfToGemini, requestTopicOutline } from '@/app/utils/geminiClient';
import { topicsFromOutlineEntries, aiTopicsCacheKey, Topic } from '@/app/utils/pdfParser';
import { setSetting } from '@/app/utils/db';

// Reads the book with Gemini, verifies the outline against the real page
// text, and saves it for this book so it only ever runs once.
export async function generateTopicsWithAI(bookId: string, file: File, apiKey: string): Promise<Topic[]> {
  const uploaded = await uploadPdfToGemini(file, apiKey);
  const outline = await requestTopicOutline({
    apiKey,
    fileUri: uploaded.uri,
    fileMimeType: uploaded.mimeType,
  });

  const topics = await topicsFromOutlineEntries(file, outline);
  if (topics.length < 2) {
    throw new Error('The AI could not find a usable outline in this document.');
  }

  await setSetting(aiTopicsCacheKey(bookId), JSON.stringify(topics));
  return topics;
}