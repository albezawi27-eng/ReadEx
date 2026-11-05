
'use client';

import { StoredChatMessage } from '@/app/utils/db';

const GEMINI_MODEL = 'gemini-3.5-flash';
const UPLOAD_BASE = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
const STREAM_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`;
// ---------------------------------------------------------------------------
// Table-of-contents extraction (used by "Improve topics with AI")
// ---------------------------------------------------------------------------

const OUTLINE_GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export interface AIOutlineEntry {
  title: string;
  page: number;
  level: number;
}

export async function requestTopicOutline(params: {
  apiKey: string;
  fileUri: string;
  fileMimeType: string;
}): Promise<AIOutlineEntry[]> {
  const { apiKey, fileUri, fileMimeType } = params;

  const prompt = [
    'You are indexing a PDF. List its table of contents as a hierarchy: parts or chapters (level 1), their sections (level 2), and subsections (level 3).',
    'Rules:',
    '- Use the document\'s own headings. If it has a printed table of contents, follow it.',
    '- "page" must be the position of the page inside THIS PDF file, counting the first page of the file as 1. It is NOT the number printed on the page; account for front matter such as the cover and preface.',
    '- Include only real headings. Never include sentences from body text, figure or table captions, or running headers.',
    '- Keep titles as written; shorten any title longer than 80 characters.',
    '- Order entries by page.',
    'Return ONLY a JSON array of objects with exactly these keys: "title" (string), "page" (integer), "level" (integer from 1 to 3). No other text.',
  ].join('\n');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180_000);

  let response: Response;
  try {
    response = await fetch(OUTLINE_GENERATE_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ fileData: { fileUri, mimeType: fileMimeType } }, { text: prompt }],
          },
        ],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Gemini took too long (over 3 minutes). Try again later.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Gemini request failed (${response.status}): ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: string = (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('');
  if (!raw.trim()) {
    throw new Error('Gemini returned an empty answer.');
  }

  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Gemini returned an outline that could not be read. Try again.');
  }

  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.entries) ? parsed.entries : null;
  if (!list) {
    throw new Error('Gemini returned an unexpected outline format.');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return list.map((e: any) => ({
    title: String(e?.title ?? ''),
    page: Number(e?.page),
    level: Number(e?.level),
  }));
}
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

  // Hard timeout so a genuine hang (network, proxy, or otherwise) surfaces
  // as a visible error after 90s instead of spinning silently forever.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90_000);

  console.log('[Gemini] Sending request...');

  let response: Response;
  try {
    response = await fetch(STREAM_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ contents: [...historyContents, newTurn] }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Gemini request timed out after 90 seconds with no response.');
    }
    throw err;
  }

  console.log('[Gemini] Response headers received, status:', response.status);

  if (!response.ok || !response.body) {
    clearTimeout(timeoutId);
    const errText = await response.text().catch(() => '');
    throw new Error(`Gemini request failed (${response.status}): ${errText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let rawChunksSeen = 0;
  let readIterations = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      readIterations++;

      if (done) {
        console.log(`[Gemini] Stream closed by server after ${readIterations} reads.`);
        break;
      }

      console.log(`[Gemini] Read #${readIterations}: ${value?.byteLength ?? 0} bytes`);

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
          console.warn('[Gemini] Failed to parse chunk', jsonStr, parseErr);
        }
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (fullText.trim() === '') {
    console.warn(`[Gemini] Stream ended with no text extracted. Raw data lines seen: ${rawChunksSeen}.`);
    throw new Error(
      rawChunksSeen === 0
        ? 'Gemini returned no data at all -- this may be a network or CORS issue.'
        : 'Gemini sent data but no readable text was found in it. Check the browser console for details.'
    );
  }

  return fullText;
}