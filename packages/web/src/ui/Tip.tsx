// The design system's dark Tooltip: pointing at a mark shows only that part (canvas S3H). Radix
// places it and keeps it accessible.

import { Tooltip as DsTooltip } from '@demiurgo/design-system';
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
        <Tooltip.Content side={side} sideOffset={6} className="z-50 max-w-72 animate-fade-in leading-snug">
          <DsTooltip>{text}</DsTooltip>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
