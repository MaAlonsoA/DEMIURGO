// Buttons are the design system's (Button): blue primary only for the action that answers what
// needs you, one per view; secondary for the other choices; quiet inside a panel; text for the way
// out. The app only lines up an icon with the words.

import { Button as DsButton, type ButtonProps as DsButtonProps } from '@demiurgo/design-system';
import { cn } from '../lib/cn.ts';

export type ButtonVariant = NonNullable<DsButtonProps['variant']>;
export type ButtonProps = DsButtonProps;

const ALIGN = 'inline-flex shrink-0 items-center justify-center gap-1.5';

export function Button({ className, ...props }: ButtonProps) {
  return <DsButton className={cn(ALIGN, className)} {...props} />;
}

/** The design system's button look for a link that acts as a button. */
export function buttonClass(variant: ButtonVariant = 'secondary', className?: string): string {
  return cn('dm-btn', `dm-btn--${variant}`, ALIGN, className);
}
