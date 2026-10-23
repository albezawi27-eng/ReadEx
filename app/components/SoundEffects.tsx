'use client';

import { useEffect } from 'react';
import { loadSoundSetting, installGlobalClickSound } from '@/app/utils/sounds';

// Renders nothing. Loads the saved mute setting and starts the app-wide
// click sound.
export default function SoundEffects() {
  useEffect(() => {
    loadSoundSetting();
    return installGlobalClickSound();
  }, []);

  return null;
}