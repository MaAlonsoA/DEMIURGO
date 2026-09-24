// Which marks are on screen and which ones the person already knows. The legend shows only the
// marks of the current screen (spec §5); what was seen lives in localStorage.

import { createContext, useContext, useEffect } from 'react';

export type LegendKey = string;

export type LegendStore = {
  register(key: LegendKey): () => void;
  subscribe(listener: () => void): () => void;
  onScreen(): LegendKey[];
};

export function createLegendStore(): LegendStore {
  const counts = new Map<LegendKey, number>();
  const listeners = new Set<() => void>();
  let snapshot: LegendKey[] = [];
  let scheduled = false;
  const emit = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      snapshot = [...counts.keys()].filter((k) => (counts.get(k) ?? 0) > 0).sort();
      for (const l of listeners) l();
    });
  };
  return {
    register(key) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      emit();
      return () => {
        counts.set(key, (counts.get(key) ?? 1) - 1);
        emit();
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onScreen: () => snapshot,
  };
}

export const LegendContext = createContext<LegendStore | null>(null);

/** A mark on screen registers itself so the legend can explain it. */
export function useLegendMark(key: LegendKey | null): void {
  const store = useContext(LegendContext);
  useEffect(() => (store && key ? store.register(key) : undefined), [store, key]);
}

const STORAGE = 'demiurgo:legend';
export type LegendMemory = { dismissed: boolean; seen: LegendKey[] };

export function readLegendMemory(): LegendMemory {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE) ?? 'null') as Partial<LegendMemory> | null;
    return { dismissed: v?.dismissed === true, seen: Array.isArray(v?.seen) ? v.seen : [] };
  } catch {
    return { dismissed: false, seen: [] };
  }
}

export function writeLegendMemory(m: LegendMemory): void {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(m));
  } catch {
    // Without storage the legend simply starts again on the next visit.
  }
}
