// Dark tooltip of the visual language: pointing at a mark shows only that part (canvas S3H).

import { Tooltip } from 'radix-ui';
import type { ReactNode } from 'react';

export function TipProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={150}>
      {children}
    </Tooltip.Provider>
  );
}

export function Tip({
  text,
  children,
  side = 'top',
}: {
  text: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-72 animate-fade-in rounded-md bg-tooltip px-2.5 py-1.5 text-xs leading-snug text-white shadow-lg"
        >
          {text}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
