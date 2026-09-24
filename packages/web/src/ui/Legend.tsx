// Legend of the marks (canvas S4B and design doc §5): bottom left, only with the marks of the
// current screen. "Got it" folds it into the ⓘ; new marks are announced there. What was seen is
// kept in localStorage. `?` opens it anywhere.

import { type ReactNode, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { cn } from '../lib/cn.ts';
import { MARKS, type MarkKind, WHO_PHRASES, type Who } from '../words.ts';
import { CloseIcon } from './icons.tsx';
import { type LegendKey, LegendContext, readLegendMemory, writeLegendMemory } from './legend-store.ts';
import { MarkGlyph } from './marks.tsx';
import { BarsGlyph, NeedsGlyph, STAGE_WORDS, type Stage, WhoGlyph } from './signals.tsx';

type Entry = { key: LegendKey; glyph: ReactNode; name: string; phrase: string };

const WHO_NAMES: Record<Who['kind'], string> = { you: 'You', demiurgo: 'DEMIURGO', agent: 'Agent', automatic: 'Automatic' };

function entryOf(key: LegendKey): Entry | null {
  const [group, value] = key.split(':') as [string, string | undefined];
  if (group === 'mark' && value && value in MARKS) {
    const m = MARKS[value as MarkKind];
    return { key, glyph: <MarkGlyph kind={value as MarkKind} />, name: m.name, phrase: m.phrase };
  }
  if (group === 'bars' && value && value in STAGE_WORDS) {
    const s = STAGE_WORDS[value as Stage];
    return { key, glyph: <BarsGlyph stage={value as Stage} />, name: s.name, phrase: s.phrase };
  }
  if (group === 'who' && value && value in WHO_PHRASES) {
    const k = value as Who['kind'];
    return { key, glyph: <WhoGlyph kind={k} size={16} />, name: WHO_NAMES[k], phrase: WHO_PHRASES[k] };
  }
  if (group === 'needs')
    return { key, glyph: <NeedsGlyph count={1} size="sm" />, name: 'Needs you', phrase: 'Things waiting for you.' };
  return null;
}

const EVERY_MARK: LegendKey[] = [
  ...Object.keys(MARKS).map((k) => `mark:${k}`),
  'bars:not-ready',
  'bars:ready',
  'bars:doubt',
  'needs',
  'who:you',
  'who:demiurgo',
  'who:agent',
  'who:automatic',
];

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
  const [everything, setEverything] = useState(false);
  const [notice, setNotice] = useState(false);
  const [hover, setHover] = useState<LegendKey | null>(null);

  const entries = useMemo(() => onScreen.map(entryOf).filter((e): e is Entry => e !== null), [onScreen]);
  const fresh = entries.filter((e) => !memory.seen.includes(e.key));
  const known = entries.filter((e) => memory.seen.includes(e.key));

  const remember = useCallback((m: { dismissed?: boolean; seen?: LegendKey[] }) => {
    setMemory((prev) => {
      const next = { dismissed: m.dismissed ?? prev.dismissed, seen: [...new Set([...prev.seen, ...(m.seen ?? [])])] };
      writeLegendMemory(next);
      return next;
    });
  }, []);

  const close = useCallback(() => {
    // An explanation that was on screen is no longer new.
    remember({ seen: entries.map((e) => e.key) });
    setOpen(false);
    setAsked(false);
    setEverything(false);
  }, [entries, remember]);

  const gotIt = () => {
    remember({ dismissed: true, seen: entries.map((e) => e.key) });
    setOpen(false);
    setEverything(false);
    setNotice(true);
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

  const list = everything ? EVERY_MARK.map(entryOf).filter((e): e is Entry => e !== null) : null;

  return (
    <div className="fixed bottom-6 left-6 z-40 flex flex-col items-start gap-2">
      {highlight && <style>{`${highlight}{outline:2px solid var(--color-needs);outline-offset:3px;border-radius:999px}`}</style>}
      {open ? (
        <section
          aria-label="What the marks mean"
          className="w-[310px] animate-fade-in rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[0_12px_32px_rgba(29,28,26,0.12)]"
        >
          <header className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">What the marks mean</h2>
            {memory.dismissed && (
              <button
                type="button"
                onClick={close}
                aria-label="Close the legend"
                className="rounded p-1 text-muted hover:text-ink"
              >
                <CloseIcon size={14} />
              </button>
            )}
          </header>
          <div className="max-h-[52vh] overflow-y-auto">
            {list ? (
              <EntryList title="Every mark" entries={list} explained onHover={setHover} />
            ) : (
              <>
                {fresh.length > 0 && (
                  <EntryList
                    title={memory.seen.length ? 'New on this screen' : 'On this screen'}
                    entries={fresh}
                    explained
                    onHover={setHover}
                  />
                )}
                {known.length > 0 && (
                  <EntryList title="Also on this screen" entries={known} explained={false} onHover={setHover} />
                )}
                {entries.length === 0 && <p className="text-xs text-muted">No marks on this screen.</p>}
              </>
            )}
          </div>
          <footer className="mt-3 flex items-center justify-between gap-3 border-t border-line-soft pt-3 text-xs">
            <button
              type="button"
              className="font-medium text-needs hover:text-needs-hover"
              onClick={() => setEverything((v) => !v)}
            >
              {everything ? 'Only this screen' : 'See every mark'}
            </button>
            {memory.dismissed ? (
              <span className="text-muted">Press ? to open it anywhere</span>
            ) : (
              <button
                type="button"
                onClick={gotIt}
                className="rounded-[var(--radius-control)] bg-ink px-3 py-1 text-xs font-semibold text-white hover:bg-ink-2"
              >
                Got it
              </button>
            )}
          </footer>
        </section>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setAsked(true);
              setOpen(true);
            }}
            aria-label={fresh.length ? `What the marks mean: ${fresh.length} new` : 'What the marks mean'}
            className={cn(
              'flex h-8 items-center gap-2 rounded-full border border-line bg-surface px-2.5 text-xs font-semibold text-ink shadow-sm hover:border-line-strong',
            )}
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full border border-ink-2 text-[10px] font-bold">
              i
            </span>
            {fresh.length > 0 && (
              <span>
                {fresh.length} new {fresh.length === 1 ? 'mark' : 'marks'}
              </span>
            )}
          </button>
          {notice && (
            <span role="status" className="animate-fade-in rounded-md bg-tooltip px-2.5 py-1.5 text-xs text-white">
              The legend stays here. Press ? to open it.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function EntryList({
  title,
  entries,
  explained,
  onHover,
}: {
  title: string;
  entries: Entry[];
  explained: boolean;
  onHover: (k: LegendKey | null) => void;
}) {
  return (
    <div className="mb-2">
      <h3 className="mb-1.5 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">{title}</h3>
      <ul className={cn('flex', explained ? 'flex-col gap-2' : 'flex-wrap gap-x-3 gap-y-1.5')}>
        {entries.map((e) => (
          <li
            key={e.key}
            onMouseEnter={() => onHover(e.key)}
            onMouseLeave={() => onHover(null)}
            className="flex items-center gap-2.5"
          >
            <span className="flex w-6 shrink-0 justify-center">{e.glyph}</span>
            {explained ? (
              <span className="flex flex-col leading-tight">
                <strong className="text-[13px] font-semibold">{e.name}</strong>
                <span className="text-xs text-ink-3">{e.phrase}</span>
              </span>
            ) : (
              <span className="text-xs text-ink-2">{e.name}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
