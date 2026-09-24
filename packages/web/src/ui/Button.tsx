// Buttons in the tokens of the visual language (shadcn/ui pattern, restyled): ink settles, blue is
// only for what asks something of the person, amber for work in progress, rust for problems.

import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/cn.ts';

export const buttonStyles = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45',
  {
    variants: {
      variant: {
        ink: 'bg-ink text-white hover:bg-ink-2',
        needs: 'bg-needs text-white hover:bg-needs-hover',
        outline: 'border border-line-strong bg-surface text-ink hover:border-ink-3',
        ghost: 'text-ink-2 hover:bg-line-soft hover:text-ink',
        link: 'px-0 text-needs underline-offset-2 hover:text-needs-hover hover:underline',
        working: 'border border-working bg-surface text-working-text hover:bg-working-bg',
        problem: 'border border-problem-line bg-surface text-problem hover:bg-problem-bg',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-8 px-3 text-[13px]',
        lg: 'h-10 px-4 text-sm',
      },
    },
    compoundVariants: [{ variant: 'link', className: 'h-auto px-0' }],
    defaultVariants: { variant: 'outline', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles> & { asChild?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      ref={ref}
      {...(asChild ? {} : { type: type ?? 'button' })}
      className={cn(buttonStyles({ variant, size }), className)}
      {...props}
    />
  );
});
