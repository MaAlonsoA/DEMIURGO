// The design system's Legend of the marks (canvas S4B and design doc §5): bottom left, only with
// the marks of the current screen. "Got it" folds it into the ⓘ; new marks are announced there. What
// was seen is kept in localStorage. `?` opens it anywhere. Pointing at an entry lights up its marks
// with ring-focus.

import { Legend as DsLegend, type LegendEntry, Tooltip } from '@demiurgo/design-system';
import { useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { MARKS, type MarkKind, WHO_PHRASES, type Who } from '../words.ts';
import { type LegendKey, LegendContext, readLegendMemory, writeLegendMemory } from './legend-store.ts';
import { MarkGlyph } from './marks.tsx';
import { BarsGlyph, NeedsGlyph, STAGE_WORDS, type Stage, WhoGlyph } from './signals.tsx';

const WHO_NAMES: Record<Who['kind'], string> = { you: 'You', demiurgo: 'DEMIURGO', agent: 'Agent', automatic: 'Automatic' };

function entryOf(key: LegendKey): LegendEntry | null {
  const [group, value] = key.split(':') as [string, string | undefined];
  if (group === 'mark' && value && value in MARKS) {
    const m = MARKS[value as MarkKind];
    return { id: key, mark: <MarkGlyph kind={value as MarkKind} />, word: m.name, desc: m.phrase };
  }
  if (group === 'bars' && value && value in STAGE_WORDS) {
    const s = STAGE_WORDS[value as Stage];
    return { id: key, mark: <BarsGlyph stage={value as Stage} />, word: s.name, desc: s.phrase };
  }
  if (group === 'who' && value && value in WHO_PHRASES) {
    const k = value as Who['kind'];
    return { id: key, mark: <WhoGlyph kind={k} size={16} />, word: WHO_NAMES[k], desc: WHO_PHRASES[k] };
  }
  if (group === 'needs') return { id: key, mark: <NeedsGlyph count={1} />, word: 'Needs you', desc: 'Things waiting for you.' };
  return null;
}

function selectorOf(key: LegendKey): string | null {
  const [group, value] = key.split(':');
  if (group === 'mark') return `[data-mark="${value}"]`;
  if (group === 'bars') return `[data-stage="${value}"]`;
  if (group === 'who') return `[data-who="${value}"]`;
  if (group === 'needs') return '[data-needs]';
  return null;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

export function Legend() {
  const store = useContext(LegendContext);
  const onScreen = useSyncExternalStore(
    useCallback((l: () => void) => store?.subscribe(l) ?? (() => undefined), [store]),
    () => store?.onScreen() ?? [],
  );
  const [memory, setMemory] = useState(readLegendMemory);
  // Until "Got it", the legend opens by itself on any screen with marks.
  const [open, setOpen] = useState(() => !readLegendMemory().dismissed);
  const [asked, setAsked] = useState(false);
  const [notice, setNotice] = useState(false);
  const [hover, setHover] = useState<LegendKey | null>(null);

  const entries = useMemo(() => onScreen.map(entryOf).filter((e): e is LegendEntry => e !== null), [onScreen]);
  const fresh = entries.filter((e) => !memory.seen.includes(e.id ?? ''));
  const known = entries.filter((e) => memory.seen.includes(e.id ?? ''));

  const remember = useCallback((m: { dismissed?: boolean; seen?: LegendKey[] }) => {
    setMemory((prev) => {
      const next = { dismissed: m.dismissed ?? prev.dismissed, seen: [...new Set([...prev.seen, ...(m.seen ?? [])])] };
      writeLegendMemory(next);
      return next;
    });
  }, []);

  const seenNow = useCallback(() => entries.map((e) => e.id ?? ''), [entries]);

  const close = useCallback(() => {
    // An explanation that was on screen is no longer new.
    remember({ seen: seenNow() });
    setOpen(false);
    setAsked(false);
    setHover(null);
  }, [remember, seenNow]);

  const gotIt = () => {
    const first = !memory.dismissed;
    remember({ dismissed: true, seen: seenNow() });
    setOpen(false);
    setAsked(false);
    setHover(null);
    if (first) setNotice(true);
  };

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(false), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !isTyping(e.target)) {
        e.preventDefault();
        if (open) close();
        else {
          setAsked(true);
          setOpen(true);
        }
      } else if (e.key === 'Escape' && open && memory.dismissed) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, memory.dismissed]);

  const highlight = hover ? selectorOf(hover) : null;

  if (entries.length === 0 && !asked) return null;

  return (
    <div className="fixed bottom-6 left-6 z-40 flex items-end gap-2">
      {highlight && <style>{`${highlight}{box-shadow:var(--ring-focus);border-radius:var(--radius-pill)}`}</style>}
      <DsLegend
        open={open}
        newMarks={fresh}
        known={known}
        onGotIt={gotIt}
        onToggle={() => {
          if (open) close();
          else {
            setAsked(true);
            setOpen(true);
          }
        }}
        onPoint={(e) => setHover(e?.id ?? null)}
        footer={entries.length === 0 ? 'No marks on this screen.' : memory.dismissed ? 'Press ? to open it anywhere.' : null}
      />
      {notice && !open && (
        <span role="status" className="mb-1 animate-fade-in">
          <Tooltip>The legend stays here. Press ? to open it.</Tooltip>
        </span>
      )}
    </div>
  );
}
