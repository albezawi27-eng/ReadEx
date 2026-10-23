'use client';

import React, { createContext, useContext, useState } from 'react';

type Theme = 'light' | 'dark' | 'colorful' | 'anime';

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

export const THEME_OPTIONS = [
  { name: 'light', label: 'Light', icon: '☀️' },
  { name: 'dark', label: 'Dark', icon: '🌙' },
  { name: 'colorful', label: 'Warm', icon: '🎨' },
  { name: 'anime', label: 'Anime', icon: '🌸' },
] as const;

const LIGHT = {
  bg: 'bg-slate-50',
  text: 'text-slate-900',
  sidebg: 'bg-white',
  sidetext: 'text-slate-700',
  border: 'border-slate-200',
  hover: 'hover:bg-slate-100',
  button:
    'bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-sm hover:from-indigo-600 hover:to-violet-600',
  active: 'bg-indigo-50 text-indigo-700',
  line: 'hover:bg-amber-50',
  card: 'bg-white',
  muted: 'text-slate-500',
  backdrop: 'bg-slate-200/70',
  hero: 'bg-gradient-to-b from-indigo-50 via-slate-50 to-slate-50',
  accent: 'from-indigo-500 to-violet-500',
};

const DARK = {
  bg: 'bg-[#0e1015]',
  text: 'text-slate-200',
  sidebg: 'bg-[#14171f]',
  sidetext: 'text-slate-300',
  border: 'border-white/10',
  hover: 'hover:bg-white/5',
  button:
    'bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-sm hover:from-indigo-400 hover:to-violet-400',
  active: 'bg-indigo-500/20 text-indigo-200',
  line: 'hover:bg-white/5',
  card: 'bg-[#1a1e29]',
  muted: 'text-slate-400',
  backdrop: 'bg-black/40',
  hero: 'bg-gradient-to-b from-[#1a1d2e] via-[#0e1015] to-[#0e1015]',
  accent: 'from-indigo-500 to-violet-500',
};

const COLORFUL = {
  bg: 'bg-amber-50',
  text: 'text-stone-800',
  sidebg: 'bg-orange-50',
  sidetext: 'text-stone-700',
  border: 'border-orange-200',
  hover: 'hover:bg-orange-100',
  button:
    'bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-sm hover:from-orange-600 hover:to-rose-600',
  active: 'bg-orange-100 text-orange-900',
  line: 'hover:bg-orange-100',
  card: 'bg-white/70',
  muted: 'text-stone-500',
  backdrop: 'bg-orange-200/50',
  hero: 'bg-gradient-to-b from-orange-100 via-amber-50 to-amber-50',
  accent: 'from-orange-500 to-rose-500',
};

const ANIME = {
  bg: 'bg-gradient-to-br from-pink-50 via-fuchsia-50 to-sky-50',
  text: 'text-indigo-950',
  sidebg: 'bg-pink-50',
  sidetext: 'text-indigo-900',
  border: 'border-pink-200',
  hover: 'hover:bg-pink-100',
  button:
    'bg-gradient-to-r from-pink-500 via-fuchsia-500 to-violet-500 text-white shadow-md shadow-pink-400/40 hover:brightness-110',
  active: 'bg-pink-200 text-pink-900',
  line: 'hover:bg-pink-100',
  card: 'bg-white',
  muted: 'text-indigo-900/60',
  backdrop: 'bg-pink-200/50',
  hero: 'bg-gradient-to-b from-pink-200 via-fuchsia-100 to-sky-100',
  accent: 'from-pink-500 to-fuchsia-500',
};

export const getThemeClasses = (theme: Theme) => {
  switch (theme) {
    case 'dark':
      return DARK;
    case 'colorful':
      return COLORFUL;
    case 'anime':
      return ANIME;
    case 'light':
    default:
      return LIGHT;
  }
};