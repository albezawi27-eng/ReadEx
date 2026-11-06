'use client';

import { useSyncExternalStore } from 'react';

// "Compact" = one pane at a time (phones, in either orientation).
// "Short" = very little vertical room (a phone held sideways), where the
// reading chrome has to shrink so the page itself gets the space.
const COMPACT_QUERY = '(max-width: 767px), (max-height: 520px)';
const SHORT_QUERY = '(max-height: 520px)';

function subscribeTo(query: string) {
  return (callback: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener('change', callback);
    return () => mq.removeEventListener('change', callback);
  };
}

function snapshotOf(query: string) {
  return () => window.matchMedia(query).matches;
}

const subscribeCompact = subscribeTo(COMPACT_QUERY);
const subscribeShort = subscribeTo(SHORT_QUERY);
const getCompact = snapshotOf(COMPACT_QUERY);
const getShort = snapshotOf(SHORT_QUERY);
const getServerSnapshot = () => false;

export function useLayoutMode(): { compact: boolean; short: boolean } {
  const compact = useSyncExternalStore(subscribeCompact, getCompact, getServerSnapshot);
  const short = useSyncExternalStore(subscribeShort, getShort, getServerSnapshot);
  return { compact, short };
}