// Buttons (DESIGN.md §6.6). One primary per region: the action the region is for. Quiet buttons for
// the rest; danger only for what destroys or rejects. Every control is at least 28 px tall and its
// hit area never below 24 × 24 (WCAG 2.5.8, R86). A pending button keeps its width, shows a spinner
// and says what it is doing ("Accepting…"): authority is never shown before the server confirms (R78).

import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from 'react';
import { cn } from '../lib/cn.ts';
import { Spinner } from './Spinner.tsx';
import { Tooltip } from './Tooltip.tsx';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'quiet-danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover border border-transparent',
  secondary: 'bg-panel text-fg border border-edge-strong hover:bg-hover hover:border-edge-control',
  quiet: 'bg-transparent text-fg-2 border border-transparent hover:bg-hover hover:text-fg',
  danger: 'bg-danger text-on-danger hover:bg-danger-hover border border-transparent',
  'quiet-danger': 'bg-transparent text-danger-text border border-transparent hover:bg-danger-soft',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 px-2.5 text-sm',
  md: 'h-8 gap-2 px-3 text-base',
  lg: 'h-10 gap-2 px-4 text-base',
};

/** The classes of a button, for links that look like one (a router Link, an anchor). */
export function buttonClass({
  variant = 'secondary',
  size = 'md',
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return cn(
    'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md font-medium whitespace-nowrap select-none',
    'transition-colors duration-[var(--m-fast)] disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon (decorative). */
  icon?: ReactNode;
  /** Trailing icon (decorative), e.g. a chevron. */
  trailing?: ReactNode;
  /** While true: a spinner, the pending label, and no second click. */
  pending?: boolean;
  /** What the button says while pending ("Accepting…"); defaults to its children. */
  pendingLabel?: ReactNode;
  /** A keyboard hint shown after the label (e.g. "Enter"). */
  kbd?: string;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    trailing,
    pending,
    pendingLabel,
    kbd,
    className,
    children,
    disabled,
    type,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={buttonClass({ variant, size, className })}
      {...rest}
    >
      {pending ? <Spinner size={size === 'sm' ? 12 : 14} /> : icon}
      <span className="truncate">{pending && pendingLabel ? pendingLabel : children}</span>
      {kbd && !pending ? (
        <kbd
          className={cn(
            'ml-0.5 rounded-xs px-1 font-ui text-xs',
            variant === 'primary' || variant === 'danger' ? 'bg-on-accent/15 text-on-accent' : 'bg-sunken text-fg-3',
          )}
        >
          {kbd}
        </kbd>
      ) : null}
      {trailing}
    </button>
  );
});

/**
 * A button that is only an icon. It always has an accessible name, and the same name as its
 * tooltip on hover and focus (R91). 32 px by default, 28 px small: both above the 24 px minimum.
 */
export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    label: string;
    children: ReactNode;
    variant?: 'quiet' | 'secondary' | 'primary';
    size?: 'sm' | 'md';
    tooltip?: boolean;
  }
>(function IconButton({ label, children, variant = 'quiet', size = 'md', tooltip = true, className, type, ...rest }, ref) {
  const button = (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors duration-[var(--m-fast)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 w-7' : 'h-8 w-8',
        variant === 'quiet' && 'border-transparent text-fg-2 hover:bg-hover hover:text-fg',
        variant === 'secondary' && 'border-edge-strong bg-panel text-fg hover:bg-hover',
        variant === 'primary' && 'border-transparent bg-accent text-on-accent hover:bg-accent-hover',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
  return tooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
});
