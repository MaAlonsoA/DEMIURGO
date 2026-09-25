// Menus and popovers (DESIGN.md §6.6), on Radix: keyboard navigable, typeahead, Esc closes and the
// focus goes back to the trigger (R93).

import { DropdownMenu, Popover as P } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { CheckIcon } from './icons.tsx';

const content =
  'z-50 min-w-52 animate-enter rounded-lg border border-edge bg-panel p-1 text-base text-fg shadow-popover outline-none';
const item =
  'flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-hover';

export function Menu({
  trigger,
  children,
  align = 'start',
  side = 'bottom',
  label,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Accessible label of the menu itself. */
  label?: string;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={content}
          aria-label={label}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({
  children,
  onSelect,
  icon,
  disabled,
  danger,
  hint,
  className,
}: {
  children: ReactNode;
  onSelect: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  /** Secondary text on the right (a shortcut, a count). */
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      // Once the menu has closed and given the focus back: a dialog opened from here then takes it.
      onSelect={() => setTimeout(onSelect, 0)}
      className={cn(item, danger && 'text-danger-text', className)}
    >
      {icon ? <span className="flex w-4 shrink-0 justify-center text-fg-2">{icon}</span> : null}
      <span className="min-w-0 flex-1">{children}</span>
      {hint ? <span className="shrink-0 text-sm text-fg-3">{hint}</span> : null}
    </DropdownMenu.Item>
  );
}

export function MenuRadioItems<V extends string>({
  value,
  onChange,
  options,
}: {
  value: V;
  onChange: (v: V) => void;
  options: { value: V; label: string }[];
}) {
  return (
    <DropdownMenu.RadioGroup value={value} onValueChange={(v) => onChange(v as V)}>
      {options.map((o) => (
        <DropdownMenu.RadioItem key={o.value} value={o.value} className={item}>
          <span className="flex w-4 shrink-0 justify-center">
            <DropdownMenu.ItemIndicator>
              <CheckIcon size={14} />
            </DropdownMenu.ItemIndicator>
          </span>
          {o.label}
        </DropdownMenu.RadioItem>
      ))}
    </DropdownMenu.RadioGroup>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="px-2.5 py-1.5 text-xs font-medium text-fg-3">{children}</DropdownMenu.Label>;
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-edge" />;
}

/** A non-modal popover anchored to its trigger (e.g. "Retry with another engine"). */
export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  align = 'start',
  label,
  className,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  label: string;
  className?: string;
}) {
  return (
    <P.Root {...(open !== undefined ? { open } : {})} {...(onOpenChange ? { onOpenChange } : {})}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content
          align={align}
          sideOffset={6}
          collisionPadding={8}
          aria-label={label}
          className={cn(
            'z-50 w-80 max-w-[calc(100vw-32px)] animate-enter rounded-lg border border-edge bg-panel p-4 shadow-popover outline-none',
            className,
          )}
        >
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
