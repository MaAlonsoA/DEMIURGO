// Side panels (DESIGN.md §3.3, §6.6): a labelled complementary region beside the main content. The
// resizable one has a real separator: arrow keys (±32 px), Home/End (min/max), double-click and a
// Reset button — never dragging only (WCAG 2.5.7, R85). Its width is remembered in this browser.

import { type KeyboardEvent, type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn.ts';

const KEY = 'dm-side-panel-width';
const MIN = 320;
const DEFAULT = 440;

function readWidth(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v >= MIN ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

function maxWidth(): number {
  return typeof window === 'undefined' ? 720 : Math.max(MIN, Math.round(window.innerWidth * 0.6));
}

/** A panel on the right whose width the person can change (Go deeper, previews). */
export function ResizablePanel({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const [width, setWidth] = useState(readWidth);
  const dragging = useRef<{ x: number; w: number } | null>(null);
  const clamp = useCallback((w: number) => Math.min(maxWidth(), Math.max(MIN, Math.round(w))), []);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, String(width));
    } catch {
      // Storage may be unavailable (private mode): the width then lasts for this visit only.
    }
  }, [width]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 96 : 32;
    if (e.key === 'ArrowLeft') setWidth((w) => clamp(w + step));
    else if (e.key === 'ArrowRight') setWidth((w) => clamp(w - step));
    else if (e.key === 'Home') setWidth(clamp(MIN));
    else if (e.key === 'End') setWidth(clamp(maxWidth()));
    else return;
    e.preventDefault();
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = { x: e.clientX, w: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    setWidth(clamp(dragging.current.w + (dragging.current.x - e.clientX)));
  };
  const onUp = () => {
    dragging.current = null;
  };

  return (
    <aside
      aria-label={label}
      className={cn('relative hidden shrink-0 border-l border-edge bg-panel lg:flex lg:flex-col', className)}
      style={{ width }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label}`}
        aria-valuemin={MIN}
        aria-valuemax={maxWidth()}
        aria-valuenow={width}
        aria-valuetext={`${width} pixels wide`}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onDoubleClick={() => setWidth(DEFAULT)}
        className="group absolute top-0 bottom-0 -left-1.5 z-10 w-3 cursor-col-resize touch-none outline-none"
      >
        <span className="absolute top-0 bottom-0 left-1.5 w-0.5 bg-transparent transition-colors group-hover:bg-accent-edge group-focus-visible:bg-focus" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </aside>
  );
}
