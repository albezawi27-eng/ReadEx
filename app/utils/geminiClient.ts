'use client';

const GEMINI_MODEL = 'gemini-3.6-flash';
const API_REVISION = '2026-05-20';
const UPLOAD_BASE = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

export interface GeminiInteractionResult {
  answerText: string;
  interactionId: string;
}

export async function uploadPdfToGemini(
  file: File,
  apiKey: string
): Promise<{ uri: string; mimeType: string }> {
  const numBytes = file.size;
  const mimeType = 'application/pdf';

  // Step 1: start a resumable upload session. The actual upload URL comes
  // back in a response HEADER, not the JSON body.
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

  // Step 2: upload the actual bytes and finalize in one shot -- fine for a
  // single PDF, no chunking needed.
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

// The Interactions API's exact response shape was still settling as of
// mid-2026. This tries the documented convenience field first, then falls
// back to scanning the steps array, so a minor format drift degrades
// gracefully instead of silently returning nothing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractAnswerText(data: any): string {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }

  if (Array.isArray(data?.steps)) {
    for (let i = data.steps.length - 1; i >= 0; i--) {
      const step = data.steps[i];
      const text =
        step?.model_output?.content?.[0]?.text ??
        step?.model_output?.text ??
        step?.content?.[0]?.text ??
        step?.text;
      if (typeof text === 'string' && text.trim()) {
        return text;
      }
    }
  }

  return "Got a response but couldn't find the answer text in it -- Gemini's response format may have shifted. Check the browser console for the raw response.";
}

export async function askGemini(params: {
  apiKey: string;
  question: string;
  documentUri?: string;
  documentMimeType?: string;
  previousInteractionId?: string;
}): Promise<GeminiInteractionResult> {
  const { apiKey, question, documentUri, documentMimeType, previousInteractionId } = params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input: any[] = [];
  if (documentUri && documentMimeType) {
    input.push({ type: 'document', uri: documentUri, mime_type: documentMimeType });
  }
  input.push({ type: 'text', text: question });

  const body: Record<string, unknown> = { model: GEMINI_MODEL, input };
  if (previousInteractionId) {
    body.previous_interaction_id = previousInteractionId;
  }

  const response = await fetch(INTERACTIONS_URL, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
      'Api-Revision': API_REVISION,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Gemini request failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const interactionId = data?.id;
  if (!interactionId) {
    throw new Error('Gemini response had no interaction id -- cannot continue this conversation.');
  }

  return { answerText: extractAnswerText(data), interactionId };
}