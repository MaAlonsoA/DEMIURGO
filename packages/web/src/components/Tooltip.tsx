// Tooltips (DESIGN.md §6.6): on hover and on keyboard focus, dismissible with Esc and hoverable
// (Radix), never the only place of essential information (WCAG 1.4.13, R91). Their trigger must be
// focusable: a button or a link — never a bare span.

import { Tooltip as T } from 'radix-ui';
import type { ReactNode } from 'react';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <T.Provider delayDuration={300} skipDelayDuration={200}>
      {children}
    </T.Provider>
  );
}

export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 max-w-72 animate-enter rounded-md bg-inverse px-2.5 py-1.5 text-sm text-on-inverse shadow-popover"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
