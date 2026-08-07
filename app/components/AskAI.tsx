'use client';

import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { useTheme, getThemeClasses } from '@/app/context/ThemeContext';
import { getSetting, setSetting, getChat, saveChat, StoredChatMessage } from '@/app/utils/db';
import { uploadPdfToGemini, askGeminiAboutBook } from '@/app/utils/geminiClient';

interface AskAIProps {
  pdfFile: File | null;
  bookId: string | null;
  onClose: () => void;
}

function normalizeLatexDelimiters(text: string): string {
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, expr) => `$$${expr}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, expr) => `$${expr}$`);
}

interface FileRef {
  bookId: string;
  uri: string;
  mimeType: string;
}

export default function AskAI({ pdfFile, bookId, onClose }: AskAIProps) {
  const { theme } = useTheme();
  const themeClasses = getThemeClasses(theme);

  const [apiKey, setApiKeyState] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [isEditingKey, setIsEditingKey] = useState(false);

  const [messages, setMessages] = useState<StoredChatMessage[]>([]);
  const [questionInput, setQuestionInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [error, setError] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Session-only cache: the uploaded file's reference is intentionally NOT
  // persisted to IndexedDB, since Gemini auto-deletes uploads after 48
  // hours -- reopening a book later just re-uploads once, avoiding any
  // stale-reference bugs entirely.
  const fileRefCacheRef = useRef<FileRef | null>(null);

  useEffect(() => {
    getSetting('geminiApiKey').then((key) => {
      setApiKeyState(key);
      if (!key) setIsEditingKey(true);
    });
  }, []);

  useEffect(() => {
    if (!bookId) return;
    getChat(bookId).then((chat) => {
      setMessages(chat?.messages ?? []);
    });
  }, [bookId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSaveKey = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    await setSetting('geminiApiKey', trimmed);
    setApiKeyState(trimmed);
    setIsEditingKey(false);
    setKeyInput('');
  };

  const handleAsk = async () => {
    const question = questionInput.trim();
    if (!question || !apiKey || !pdfFile || !bookId) return;

    setError('');
    setQuestionInput('');
    const historyBeforeThisTurn = messages;
    const userMessage: StoredChatMessage = { role: 'user', text: question };
    setMessages((prev) => [...prev, userMessage]);

    try {
      let fileRef = fileRefCacheRef.current;
      if (!fileRef || fileRef.bookId !== bookId) {
        setIsUploading(true);
        const uploaded = await uploadPdfToGemini(pdfFile, apiKey);
        fileRef = { bookId, uri: uploaded.uri, mimeType: uploaded.mimeType };
        fileRefCacheRef.current = fileRef;
        setIsUploading(false);
      }

      setIsAsking(true);
      const answerText = await askGeminiAboutBook({
        apiKey,
        question,
        history: historyBeforeThisTurn,
        fileUri: fileRef.uri,
        fileMimeType: fileRef.mimeType,
      });

      const modelMessage: StoredChatMessage = { role: 'model', text: answerText };
      const finalMessages = [...historyBeforeThisTurn, userMessage, modelMessage];
      setMessages(finalMessages);
      saveChat({ bookId, messages: finalMessages });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong asking Gemini.';
      setError(msg);
      // If the upload step itself is what's blocked (e.g. a CORS wall),
      // clear the cache so the next attempt retries cleanly instead of
      // reusing a reference that never actually succeeded.
      if (fileRefCacheRef.current?.bookId === bookId && !fileRefCacheRef.current.uri) {
        fileRefCacheRef.current = null;
      }
    } finally {
      setIsUploading(false);
      setIsAsking(false);
    }
  };

  const isBusy = isUploading || isAsking;

  return (
    <div
      className={`absolute inset-y-0 right-0 w-full sm:w-96 ${themeClasses.sidebg} ${themeClasses.sidetext} border-l ${themeClasses.border} border-opacity-30 shadow-2xl flex flex-col z-20`}
    >
      <div className={`px-4 py-3 border-b ${themeClasses.border} border-opacity-20 flex items-center justify-between shrink-0`}>
        <h2 className="font-semibold text-sm">Ask AI about this book</h2>
        <button onClick={onClose} className={`w-8 h-8 rounded-lg flex items-center justify-center ${themeClasses.hover}`}>
          ✕
        </button>
      </div>

      {isEditingKey ? (
        <div className="p-4 flex-1 overflow-y-auto">
          <p className="text-sm opacity-75 mb-3">
            Paste a free Gemini API key to use this feature. Your key stays on this device only.
          </p>
          <button
            onClick={() => window.open('https://aistudio.google.com/apikey', '_blank', 'noopener,noreferrer')}
            className="text-sm underline opacity-80 hover:opacity-100 text-left"
          >
            Get a free key from Google AI Studio →
          </button>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="AIza... or AQ...."
            className={`w-full mt-3 px-3 py-2 rounded-lg text-sm bg-transparent border ${themeClasses.border} border-opacity-30 focus:outline-none focus:ring-1 focus:ring-current`}
          />
          <button
            onClick={handleSaveKey}
            className={`w-full mt-3 px-4 py-2 rounded-lg font-medium text-sm ${themeClasses.button}`}
          >
            Save key
          </button>
          {apiKey && (
            <button
              onClick={() => setIsEditingKey(false)}
              className={`w-full mt-2 px-4 py-2 rounded-lg text-sm ${themeClasses.hover} border ${themeClasses.border} border-opacity-30`}
            >
              Cancel
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <p className="text-sm opacity-60">
                Ask anything about this book -- Gemini reads the full PDF with your first question.
              </p>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`text-sm p-3 rounded-lg ${msg.role === 'user' ? themeClasses.active : themeClasses.hover}`}
              >
                <div className="text-xs opacity-50 mb-1 uppercase tracking-wide">
                  {msg.role === 'user' ? 'You' : 'Gemini'}
                </div>
                {msg.role === 'user' ? (
                  <div className="whitespace-pre-wrap">{msg.text}</div>
                ) : (
                  <div className="ai-markdown">
                    <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
                      {normalizeLatexDelimiters(msg.text)}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            ))}
            {isBusy && (
              <div className="text-sm opacity-60 italic">
                {isUploading ? 'Uploading PDF (first question only)...' : 'Thinking...'}
              </div>
            )}
            {error && <div className="text-sm text-red-500">{error}</div>}
            <div ref={messagesEndRef} />
          </div>

          <div className={`p-3 border-t ${themeClasses.border} border-opacity-20 shrink-0`}>
            <div className="flex gap-2">
              <input
                type="text"
                value={questionInput}
                onChange={(e) => setQuestionInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isBusy && handleAsk()}
                placeholder="Ask a question..."
                disabled={isBusy}
                className={`flex-1 px-3 py-2 rounded-lg text-sm bg-transparent border ${themeClasses.border} border-opacity-30 focus:outline-none focus:ring-1 focus:ring-current disabled:opacity-50`}
              />
              <button
                onClick={handleAsk}
                disabled={isBusy || !questionInput.trim()}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${themeClasses.button} disabled:opacity-40`}
              >
                Ask
              </button>
            </div>
            <button onClick={() => setIsEditingKey(true)} className="text-xs opacity-50 hover:opacity-80 mt-2">
              Change API key
            </button>
          </div>
        </>
      )}
    </div>
  );
}