'use client';

import { useEffect, useState } from 'react';
import { getSetting, setSetting } from '@/app/utils/db';

// Overall loudness of every sound effect (0 = silent, 1 = full).
const MASTER_VOLUME = 0.6;

let soundEnabled = true;
let audioCtx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let lastPageTurnAt = 0;
let lastClickAt = 0;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export async function loadSoundSetting(): Promise<void> {
  try {
    const stored = await getSetting('soundEnabled');
    soundEnabled = stored !== 'false';
    notify();
  } catch {
    // Storage unavailable -- keep the default (sound on).
  }
}

export function setSoundEnabled(value: boolean): void {
  soundEnabled = value;
  notify();
  setSetting('soundEnabled', String(value)).catch(() => {});
}

export function useSoundEnabled(): [boolean, (value: boolean) => void] {
  const [enabled, setEnabled] = useState(soundEnabled);

  useEffect(() => {
    const sync = () => setEnabled(soundEnabled);
    listeners.add(sync);
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, []);

  return [enabled, setSoundEnabled];
}

// The audio context is created lazily, inside a click or key press, because
// browsers refuse to start audio before the user has interacted with the page.
function getAudio(): { ctx: AudioContext; out: GainNode } | null {
  if (typeof window === 'undefined') return null;

  if (!audioCtx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
    master = audioCtx.createGain();
    master.gain.value = MASTER_VOLUME;
    master.connect(audioCtx.destination);
  }

  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return { ctx: audioCtx, out: master! };
}

function getNoise(ctx: AudioContext): AudioBuffer {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    const length = ctx.sampleRate; // one second of white noise
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

// Paper page turn: a filtered-noise "swish" that sweeps upward, plus a few
// tiny high-frequency ticks like paper crinkling.
export function playPageTurn(): void {
  if (!soundEnabled) return;
  const audio = getAudio();
  if (!audio) return;
  const { ctx, out } = audio;

  lastPageTurnAt = Date.now();
  const t = ctx.currentTime;

  const swish = ctx.createBufferSource();
  swish.buffer = getNoise(ctx);
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.Q.value = 0.7;
  bandpass.frequency.setValueAtTime(700, t);
  bandpass.frequency.exponentialRampToValueAtTime(5200, t + 0.24);
  const swishGain = ctx.createGain();
  swishGain.gain.setValueAtTime(0.0001, t);
  swishGain.gain.exponentialRampToValueAtTime(0.5, t + 0.04);
  swishGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  swish.connect(bandpass);
  bandpass.connect(swishGain);
  swishGain.connect(out);
  swish.start(t, Math.random() * 0.5);
  swish.stop(t + 0.32);

  for (let i = 0; i < 4; i++) {
    const at = t + 0.02 + Math.random() * 0.2;
    const src = ctx.createBufferSource();
    src.buffer = getNoise(ctx);
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 3500 + Math.random() * 2500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.15 + Math.random() * 0.1, at + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.02);
    src.connect(highpass);
    highpass.connect(gain);
    gain.connect(out);
    src.start(at, Math.random() * 0.5);
    src.stop(at + 0.03);
  }
}

// Soft wooden "tock" with a faint paper click on top. Pitch varies a little
// each time so repeated clicks don't sound mechanical.
export function playClick(): void {
  if (!soundEnabled) return;
  const audio = getAudio();
  if (!audio) return;
  const { ctx, out } = audio;

  lastClickAt = Date.now();
  const t = ctx.currentTime;
  const pitch = 1 + (Math.random() - 0.5) * 0.16;

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(260 * pitch, t);
  osc.frequency.exponentialRampToValueAtTime(95 * pitch, t + 0.07);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.0001, t);
  oscGain.gain.exponentialRampToValueAtTime(0.4, t + 0.004);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  osc.connect(oscGain);
  oscGain.connect(out);
  osc.start(t);
  osc.stop(t + 0.1);

  const src = ctx.createBufferSource();
  src.buffer = getNoise(ctx);
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 2200;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.0001, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.12, t + 0.002);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
  src.connect(highpass);
  highpass.connect(noiseGain);
  noiseGain.connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + 0.03);
}

// One listener for the whole app: any button or label click gets the tock.
// Elements opt in with data-click-sound, or out with data-no-click-sound.
export function installGlobalClickSound(): () => void {
  const handler = (e: MouseEvent) => {
    if (!soundEnabled) return;
    const target = e.target as HTMLElement | null;
    const el = target?.closest?.('button, label, summary, [role="button"], [data-click-sound]');
    if (!el) return;
    if (el.closest('[data-no-click-sound]')) return;
    if ((el as HTMLButtonElement).disabled) return;

    // Deferred a tick so a page-turn triggered by this same click (Next/Prev)
    // has already registered, whatever order the listeners ran in. Also drops
    // the duplicate click a label sends to its file input.
    setTimeout(() => {
      const now = Date.now();
      if (now - lastPageTurnAt < 250) return;
      if (now - lastClickAt < 80) return;
      playClick();
    }, 0);
  };

  document.addEventListener('click', handler);
  return () => document.removeEventListener('click', handler);
}