// Under 1024 px the thread's side panel has no room beside the conversation (DESIGN.md §3.3, §6.3):
// its content — Go deeper, or the questions and the threads inside — opens as a sheet over the page
// instead. The sheet is a modal dialog: the focus goes in, Esc closes it, and the focus returns to
// what opened it (R95).

import { Dialog as D } from 'radix-ui';
import { type ReactNode, useSyncExternalStore } from 'react';

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

export function Sheet({
  open,
  onOpenChange,
  label,
  children,
  onOpenAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The sheet's name for screen readers ("Go deeper", "In this thread"). */
  label: string;
  children: ReactNode;
  onOpenAutoFocus?: (e: Event) => void;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 animate-enter bg-scrim" />
        <D.Content
          aria-describedby={undefined}
          {...(onOpenAutoFocus ? { onOpenAutoFocus } : {})}
          className="fixed inset-y-0 right-0 z-50 flex w-full animate-enter flex-col overflow-y-auto border-l border-edge bg-panel shadow-dialog sm:w-[480px] sm:max-w-[92vw]"
        >
          <D.Title className="sr-only">{label}</D.Title>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** The Close of a sheet whose content has none of its own. */
export const SheetClose = D.Close;
