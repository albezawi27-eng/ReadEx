'use client';

import { StoredChatMessage } from '@/app/utils/db';

const GEMINI_MODEL = 'gemini-3.5-flash';
const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const UPLOAD_BASE = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

export async function uploadPdfToGemini(
  file: File,
  apiKey: string
): Promise<{ uri: string; mimeType: string }> {
  const numBytes = file.size;
  const mimeType = 'application/pdf';

  const startResponse = await fetch(UPLOAD_BASE, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(numBytes),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: file.name } }),
  });

  if (!startResponse.ok) {
    const errText = await startResponse.text().catch(() => '');
    throw new Error(`Gemini upload session failed (${startResponse.status}): ${errText}`);
  }

  const uploadUrl = startResponse.headers.get('x-goog-upload-url');
  if (!uploadUrl) {
    throw new Error('Gemini did not return an upload URL. The API response format may have changed.');
  }

  const fileBytes = await file.arrayBuffer();
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(numBytes),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: fileBytes,
  });

  if (!uploadResponse.ok) {
    const errText = await uploadResponse.text().catch(() => '');
    throw new Error(`Gemini file upload failed (${uploadResponse.status}): ${errText}`);
  }

  const uploadData = await uploadResponse.json();
  const uploadedUri = uploadData?.file?.uri;
  const uploadedMimeType = uploadData?.file?.mimeType || mimeType;

  if (!uploadedUri) {
    throw new Error('Gemini upload succeeded but returned no file URI.');
  }

  return { uri: uploadedUri, mimeType: uploadedMimeType };
}

export async function askGeminiAboutBook(params: {
  apiKey: string;
  question: string;
  history: StoredChatMessage[];
  fileUri: string;
  fileMimeType: string;
}): Promise<string> {
  const { apiKey, question, history, fileUri, fileMimeType } = params;

  const historyContents = history.map((msg) => ({
    role: msg.role,
    parts: [{ text: msg.text }],
  }));

  // The file is referenced (cheap) rather than embedded (expensive) on
  // every request -- only the upload step pays the full document cost.
  const newTurn = {
    role: 'user',
    parts: [{ fileData: { fileUri, mimeType: fileMimeType } }, { text: question }],
  };

  const response = await fetch(GENERATE_URL, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ contents: [...historyContents, newTurn] }),
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