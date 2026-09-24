// "Point, peek, keep" (design doc §4): pointing at a card for ~0.4 s shows its detail beside it,
// chained instantly if another one was open; a click keeps it; "Open" goes to the full page.
// With the keyboard, focusing the card shows the peek and Enter opens the page.

import { Popover } from 'radix-ui';
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn.ts';

let lastPeekAt = 0;
const DELAY = 400;
const CHAIN_WINDOW = 350;

export function Peek({
  children,
  content,
  onOpen,
  label,
  className,
}: {
  children: ReactNode;
  content: ReactNode;
  onOpen: () => void;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [kept, setKept] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inside = useRef(false);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => clear, []);

  const show = (immediate = false) => {
    clear();
    const chained = Date.now() - lastPeekAt < CHAIN_WINDOW;
    if (immediate || chained) {
      setOpen(true);
      lastPeekAt = Date.now();
      return;
    }
    timer.current = setTimeout(() => {
      setOpen(true);
      lastPeekAt = Date.now();
    }, DELAY);
  };
  const hide = () => {
    clear();
    if (kept) return;
    timer.current = setTimeout(() => {
      if (inside.current) return;
      setOpen((was) => {
        if (was) lastPeekAt = Date.now();
        return false;
      });
    }, 120);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onOpen();
    } else if (e.key === 'Escape') {
      setKept(false);
      setOpen(false);
    }
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setKept(false);
          setOpen(false);
        }
      }}
    >
      <Popover.Anchor asChild>
        {/* The card is focusable: focus shows the peek and Enter opens the full page. */}
        <div
          role="link"
          tabIndex={0}
          aria-label={label}
          data-kept={kept && open ? 'true' : undefined}
          className={cn(
            'block rounded-[var(--radius-card)] outline-none focus-visible:ring-2 focus-visible:ring-needs',
            className,
          )}
          onPointerEnter={() => show()}
          onPointerLeave={hide}
          onFocus={() => show(true)}
          onBlur={(e) => {
            if (!e.currentTarget.parentElement?.contains(e.relatedTarget)) hide();
          }}
          onClick={() => {
            setKept(true);
            setOpen(true);
          }}
          onDoubleClick={onOpen}
          onKeyDown={onKeyDown}
        >
          {children}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          aria-label={label}
          side="right"
          align="start"
          sideOffset={10}
          collisionPadding={16}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onPointerEnter={() => {
            inside.current = true;
            clear();
          }}
          onPointerLeave={() => {
            inside.current = false;
            hide();
          }}
          className="z-40 w-[380px] animate-fade-in drop-shadow-[0_12px_28px_rgba(29,28,26,0.14)]"
        >
          {content}
          {kept && <span className="sr-only">Kept open. Press Escape to close.</span>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
