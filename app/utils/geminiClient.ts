'use client';

import { StoredChatMessage } from '@/app/utils/db';

// If this ever 404s or comes back model-not-found, check the current
// free-tier line-up at https://ai.google.dev/pricing and swap this string.
const GEMINI_MODEL = 'gemini-3.5-flash';
const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function blobToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:application/pdf;base64," prefix -- inlineData.data
      // needs pure base64, nothing else.
      const base64 = result.split(',')[1] ?? '';
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read PDF file for upload.'));
    reader.readAsDataURL(file);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildContents(
  history: StoredChatMessage[],
  newQuestion: string,
  pdfFile: File
): Promise<any[]> {
  const base64Data = await blobToBase64(pdfFile);
  const allTurns: StoredChatMessage[] = [...history, { role: 'user', text: newQuestion }];
  const firstUserIndex = allTurns.findIndex((m) => m.role === 'user');

  return allTurns.map((msg, index) => {
    if (index === firstUserIndex) {
      return {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'application/pdf', data: base64Data } },
          { text: msg.text },
        ],
      };
    }
    return { role: msg.role, parts: [{ text: msg.text }] };
  });
}

export async function askGeminiAboutBook(params: {
  apiKey: string;
  question: string;
  history: StoredChatMessage[];
  pdfFile: File;
}): Promise<string> {
  const { apiKey, question, history, pdfFile } = params;
  const contents = await buildContents(history, question, pdfFile);

  const response = await fetch(GENERATE_URL, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ contents }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Gemini request failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (typeof text !== 'string') {
    throw new Error('Gemini returned a response but no answer text was found in it.');
  }

  return text;
}