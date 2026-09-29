// Side panels (DESIGN.md §3.3, §6.6): a labelled complementary region beside the main content. The
// resizable one has a real separator: arrow keys (±32 px), Home/End (min/max), double-click and a
// Reset button — never dragging only (WCAG 2.5.7, R85). Its width is remembered in this browser.

import { type KeyboardEvent, type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useMessages } from '../i18n/define.ts';
import { cn } from '../lib/cn.ts';
import { SIDE_PANEL } from './words.i18n.ts';

const KEY = 'dm-side-panel-width';
const MIN = 320;
const DEFAULT = 440;

export type Size = {
  /** Where the width is remembered in this browser. */
  key: string;
  min: number;
  initial: () => number;
  /** The widest it can be, for the window's current width. */
  max: () => number;
};

const SIDE: Size = {
  key: KEY,
  min: MIN,
  initial: () => DEFAULT,
  max: () => (typeof window === 'undefined' ? 720 : Math.max(MIN, Math.round(window.innerWidth * 0.6))),
};

function readWidth(size: Size): number {
  try {
    const v = Number(localStorage.getItem(size.key));
    return Number.isFinite(v) && v >= size.min ? Math.min(v, size.max()) : Math.min(size.initial(), size.max());
  } catch {
    return Math.min(size.initial(), size.max());
  }
}

/** The width of a panel on the right that the person can change, remembered in this browser. */
export function useResizableWidth(size: Size): [number, (w: number | ((w: number) => number)) => void] {
  const [width, setWidth] = useState(() => readWidth(size));
  const clamp = useCallback((w: number) => Math.min(size.max(), Math.max(size.min, Math.round(w))), [size]);
  useEffect(() => {
    try {
      localStorage.setItem(size.key, String(width));
    } catch {
      // Storage may be unavailable (private mode): the width then lasts for this visit only.
    }
  }, [size.key, width]);
  const set = useCallback(
    (w: number | ((w: number) => number)) => setWidth((prev) => clamp(typeof w === 'function' ? w(prev) : w)),
    [clamp],
  );
  return [width, set];
}

/** The separator on the left edge of a panel on the right: drag, arrow keys, Home/End, double-click. */
export function ResizeHandle({
  label,
  size,
  width,
  onWidth,
}: {
  label: string;
  size: Size;
  width: number;
  onWidth: (w: number | ((w: number) => number)) => void;
}) {
  const t = useMessages(SIDE_PANEL);
  const dragging = useRef<{ x: number; w: number } | null>(null);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 96 : 32;
    if (e.key === 'ArrowLeft') onWidth((w) => w + step);
    else if (e.key === 'ArrowRight') onWidth((w) => w - step);
    else if (e.key === 'Home') onWidth(size.min);
    else if (e.key === 'End') onWidth(size.max());
    else return;
    e.preventDefault();
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = { x: e.clientX, w: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    onWidth(dragging.current.w + (dragging.current.x - e.clientX));
  };
  const onUp = () => {
    dragging.current = null;
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t.resize(label)}
      aria-valuemin={size.min}
      aria-valuemax={size.max()}
      aria-valuenow={width}
      aria-valuetext={t.pixelsWide(width)}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onDoubleClick={() => onWidth(size.initial())}
      className="group absolute top-0 bottom-0 -left-1.5 z-10 w-3 cursor-col-resize touch-none outline-none"
    >
      <span className="absolute top-0 bottom-0 left-1.5 w-0.5 bg-transparent transition-colors group-hover:bg-accent-edge group-focus-visible:bg-focus" />
    </div>
  );
}

/** A panel on the right whose width the person can change (Go deeper, previews). */
export function ResizablePanel({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const [width, setWidth] = useResizableWidth(SIDE);
  return (
    <aside
      aria-label={label}
      className={cn('relative hidden shrink-0 border-l border-edge bg-panel lg:flex lg:flex-col', className)}
      style={{ width }}
    >
      <ResizeHandle label={label} size={SIDE} width={width} onWidth={setWidth} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </aside>
  );
}
