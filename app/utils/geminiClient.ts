'use client';

import { StoredChatMessage } from '@/app/utils/db';

const GEMINI_MODEL = 'gemini-3.5-flash';
const UPLOAD_BASE = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
const STREAM_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`;

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

// Streams the answer as it generates rather than waiting for the full
// response -- doesn't reduce total generation time (that's inherent to
// how much context the model has to process) but starts showing text
// within a second or two instead of one long silent wait. onChunk is
// called with the accumulated text so far after every new piece arrives.
export async function askGeminiAboutBookStream(params: {
  apiKey: string;
  question: string;
  history: StoredChatMessage[];
  fileUri: string;
  fileMimeType: string;
  onChunk: (textSoFar: string) => void;
}): Promise<string> {
  const { apiKey, question, history, fileUri, fileMimeType, onChunk } = params;

  const historyContents = history.map((msg) => ({
    role: msg.role,
    parts: [{ text: msg.text }],
  }));

  const newTurn = {
    role: 'user',
    parts: [{ fileData: { fileUri, mimeType: fileMimeType } }, { text: question }],
  };

  const response = await fetch(STREAM_URL, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ contents: [...historyContents, newTurn] }),
  });

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Gemini request failed (${response.status}): ${errText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let rawChunksSeen = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // Normalize line endings first -- some servers send \r\n, which would
    // otherwise leave a stray \r prefixed onto every line and silently
    // break the startsWith('data:') check below on every single chunk.
    const decoded = decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    buffer += decoded;

    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const event of events) {
      const dataLine = event.split('\n').find((line) => line.trim().startsWith('data:'));
      if (!dataLine) continue;
      const jsonStr = dataLine.slice(dataLine.indexOf(':') + 1).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;

      rawChunksSeen++;
      try {
        const parsed = JSON.parse(jsonStr);
        const chunkText = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof chunkText === 'string') {
          fullText += chunkText;
          onChunk(fullText);
        }
      } catch (parseErr) {
        console.warn('Gemini stream: failed to parse chunk', jsonStr, parseErr);
      }
    }
  }

  if (fullText.trim() === '') {
    console.warn(`Gemini stream ended with no text extracted. Raw data lines seen: ${rawChunksSeen}.`);
    throw new Error(
      rawChunksSeen === 0
        ? 'Gemini returned no data at all -- this may be a network or CORS issue.'
        : 'Gemini sent data but no readable text was found in it -- the response format may have changed. Check the browser console for details.'
    );
  }

  return fullText;
}