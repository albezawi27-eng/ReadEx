'use client';

import React, { useState } from 'react';
import { useTheme, getThemeClasses } from '@/app/context/ThemeContext';
import { extractPDFText, PDFSection } from '@/app/utils/pdfParser';

interface Section {
  id: string;
  title: string;
  content: string;
}

interface SidebarProps {
  sections: Section[];
  activeSection: string | null;
  onSectionSelect: (id: string) => void;
  progress: Set<string>;
  onProgressToggle: (id: string) => void;
  onPDFExtracted?: (sections: PDFSection[], file?: File) => void;
  onBackToLibrary?: () => void;
}

export default function Sidebar({
  sections,
  activeSection,
  onSectionSelect,
  progress,
  onProgressToggle,
  onPDFExtracted,
  onBackToLibrary,
}: SidebarProps) {
  const { theme, setTheme } = useTheme();
  const themeClasses = getThemeClasses(theme);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setUploadError('');

    if (!file) return;

    if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
      setUploadError('Please upload a PDF file');
      return;
    }

    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      setUploadError('File size exceeds 50MB limit');
      return;
    }

    setIsUploading(true);
    try {
      const extractedSections = await extractPDFText(file);
      setUploadedFile(file);

      if (onPDFExtracted) {
        onPDFExtracted(extractedSections, file);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to process PDF';
      setUploadError(errorMsg);
      console.error('PDF extraction error:', error);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div
      className={`w-full md:w-80 ${themeClasses.sidebg} ${themeClasses.sidetext} border-r ${themeClasses.border} flex flex-col h-screen overflow-hidden`}
    >
      {/* Upload Section */}
      <div className="p-6 border-b border-current opacity-20">
        {onBackToLibrary && (
          <button
            onClick={onBackToLibrary}
            className={`w-full mb-3 px-4 py-2 rounded-lg text-sm font-medium transition ${themeClasses.hover} border ${themeClasses.border} border-opacity-30`}
          >
            📚 My Library
          </button>
        )}

        <label
          className={`block w-full px-4 py-3 rounded-lg font-medium cursor-pointer transition ${
            uploadedFile
              ? `bg-green-500 hover:bg-green-600 text-white`
              : themeClasses.button
          } text-center ${isUploading ? 'opacity-60' : ''}`}
        >
          <input
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={handleFileUpload}
            disabled={isUploading}
          />
          {isUploading ? '⏳ Processing...' : uploadedFile ? '✅ PDF Loaded' : '📄 Upload PDF'}
        </label>

        {uploadedFile && (
          <div className="mt-3 p-2 bg-opacity-20 bg-green-500 rounded text-xs">
            <p className="font-semibold truncate">📋 {uploadedFile.name}</p>
            <p className="opacity-75 text-xs mt-1">
              Size: {(uploadedFile.size / 1024).toFixed(2)} KB
            </p>
          </div>
        )}

        {uploadError && (
          <div className="mt-3 p-2 bg-opacity-20 bg-red-500 rounded text-xs text-red-700 dark:text-red-300">
            <p className="font-semibold">⚠️ {uploadError}</p>
          </div>
        )}
      </div>

      {/* Sections List */}
      <div className="flex-1 overflow-y-auto p-4">
        <h3 className="font-semibold mb-4 text-sm opacity-75">SECTIONS</h3>
        <div className="space-y-2">
          {sections.map((section) => (
            <div
              key={section.id}
              className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition"
              onClick={() => onSectionSelect(section.id)}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onProgressToggle(section.id);
                }}
                className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition ${
                  progress.has(section.id)
                    ? `${themeClasses.active} border-current`
                    : `border-current opacity-40 hover:opacity-70`
                }`}
              >
                {progress.has(section.id) && <span className="text-sm">✓</span>}
              </button>

              <button
                className={`flex-1 text-left text-sm font-medium px-3 py-2 rounded transition ${
                  activeSection === section.id ? themeClasses.active : themeClasses.hover
                }`}
                onClick={() => onSectionSelect(section.id)}
              >
                {section.title}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Theme Customizer */}
      <div className="p-4 border-t border-current opacity-20">
        <h4 className="text-xs font-semibold uppercase mb-3 opacity-75">Theme</h4>
        <div className="grid grid-cols-3 gap-2">
          {[
            { name: 'light', label: '☀️ Light', emoji: 'light' },
            { name: 'dark', label: '🌙 Dark', emoji: 'dark' },
            { name: 'colorful', label: '🎨 Colorful', emoji: 'colorful' },
          ].map((themeOption) => (
            <button
              key={themeOption.name}
              onClick={() => setTheme(themeOption.name as 'light' | 'dark' | 'colorful')}
              className={`py-2 px-2 text-xs rounded font-semibold transition ${
                theme === themeOption.name
                  ? `${themeClasses.active} ring-2 ring-current`
                  : `${themeClasses.hover} opacity-70`
              }`}
            >
              {themeOption.label}
            </button>
          ))}
        </div>
        <p className="text-xs opacity-50 mt-3">
          Progress: {progress.size} / {sections.length} completed
        </p>
      </div>
    </div>
  );
}