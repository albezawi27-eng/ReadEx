'use client';

import React, { createContext, useContext, useState } from 'react';

type Theme = 'light' | 'dark' | 'colorful';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}

export const getThemeClasses = (theme: Theme) => {
  switch (theme) {
    case 'light':
      return {
        bg: 'bg-white',
        text: 'text-gray-900',
        sidebg: 'bg-gray-50',
        sidetext: 'text-gray-700',
        border: 'border-gray-200',
        hover: 'hover:bg-gray-100',
        button: 'bg-blue-500 hover:bg-blue-600 text-white',
        active: 'bg-blue-100 text-blue-900',
        line: 'hover:bg-yellow-100',
      };
    case 'dark':
      return {
        // Softer than pure black/white: near-black bg, off-white text.
        // Cuts contrast from ~15.8:1 to a still-highly-legible ~12:1,
        // reducing glare during sustained reading.
        bg: 'bg-[#1a1b1e]',
        text: 'text-[#dcdde0]',
        sidebg: 'bg-[#212226]',
        sidetext: 'text-[#b8bac0]',
        border: 'border-[#33343a]',
        hover: 'hover:bg-[#2a2b30]',
        button: 'bg-blue-600 hover:bg-blue-500 text-white',
        active: 'bg-blue-500 bg-opacity-20 text-blue-200',
        line: 'hover:bg-[#2a2b30]',
      };
    case 'colorful':
      return {
        // Saturation concentrated in the button and active state rather
        // than smeared across bg/sidebar/hover; body text is a neutral
        // warm-gray instead of a saturated color, so it stays legible
        // against the warm background instead of both competing.
        bg: 'bg-orange-50',
        text: 'text-stone-800',
        sidebg: 'bg-orange-100',
        sidetext: 'text-stone-700',
        border: 'border-orange-200',
        hover: 'hover:bg-orange-200',
        button: 'bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 text-white',
        active: 'bg-orange-200 text-orange-900',
        line: 'hover:bg-orange-200',
      };
    default:
      return {
        bg: 'bg-white',
        text: 'text-gray-900',
        sidebg: 'bg-gray-50',
        sidetext: 'text-gray-700',
        border: 'border-gray-200',
        hover: 'hover:bg-gray-100',
        button: 'bg-blue-500 hover:bg-blue-600 text-white',
        active: 'bg-blue-100 text-blue-900',
        line: 'hover:bg-yellow-100',
      };
  }
};