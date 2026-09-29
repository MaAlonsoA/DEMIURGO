// Under 1024 px the thread's side panel has no room beside the conversation (DESIGN.md §3.3, §6.3):
// its content — Go deeper, or the questions and the threads inside — opens as a sheet over the page
// instead. The sheet is a modal dialog: the focus goes in, Esc closes it, and the focus returns to
// what opened it (R95). A wide sheet (Go deeper over Day 1) has room for the conversation and a
// separator on its left edge to widen or narrow it, like the thread's side panel.

import { Dialog as D } from 'radix-ui';
import { type CSSProperties, type ReactNode, useSyncExternalStore } from 'react';
import { ResizeHandle, type Size, useResizableWidth } from '../../components/SidePanel.tsx';
import { cn } from '../../lib/cn.ts';

const WIDE = '(min-width: 1024px)';

/** True from the lg breakpoint (1024 px), where the side panel sits beside the conversation. */
export function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(WIDE);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

const WIDE_SHEET: Size = {
  key: 'dm-wide-sheet-width',
  min: 360,
  initial: () => (typeof window === 'undefined' ? 720 : Math.round(window.innerWidth * 0.5)),
  max: () => (typeof window === 'undefined' ? 1200 : Math.max(360, Math.round(window.innerWidth * 0.9))),
};

export function Sheet({
  open,
  onOpenChange,
  label,
  children,
  onOpenAutoFocus,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The sheet's name for screen readers ("Go deeper", "In this thread"). */
  label: string;
  children: ReactNode;
  onOpenAutoFocus?: (e: Event) => void;
  /** Half the window to start with, and resizable. */
  wide?: boolean;
}) {
  const [width, setWidth] = useResizableWidth(WIDE_SHEET);
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 animate-enter bg-scrim" />
        <D.Content
          aria-describedby={undefined}
          {...(onOpenAutoFocus ? { onOpenAutoFocus } : {})}
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full animate-enter flex-col border-l border-edge bg-panel shadow-dialog sm:max-w-[92vw]',
            wide ? 'sm:w-(--sheet-width)' : 'overflow-y-auto sm:w-[480px]',
          )}
          style={wide ? ({ '--sheet-width': `${width}px` } as CSSProperties) : undefined}
        >
          <D.Title className="sr-only">{label}</D.Title>
          {wide ? (
            <>
              <span className="hidden sm:contents">
                <ResizeHandle label={label} size={WIDE_SHEET} width={width} onWidth={setWidth} />
              </span>
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
            </>
          ) : (
            children
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** The Close of a sheet whose content has none of its own. */
export const SheetClose = D.Close;
