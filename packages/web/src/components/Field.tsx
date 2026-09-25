// Form controls (DESIGN.md §6.6). A visible label always; the hint and the error are tied to the
// control with aria-describedby; limits are counted where the person types. Borders of empty
// controls reach 3:1 (edge-control, R90). ChoiceGroup is a real radio or checkbox group with a
// legend, moved through with the arrow keys (R93).

import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  forwardRef,
  useId,
  useLayoutEffect,
  useRef,
} from 'react';
import { cn } from '../lib/cn.ts';
import { CheckIcon, ChevronDownIcon } from './icons.tsx';

export const controlClass = cn(
  'w-full rounded-md border border-edge-control bg-panel px-3 text-base text-fg placeholder:text-fg-3',
  'hover:border-fg-3 focus:border-focus focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-0',
  'disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-60 aria-[invalid=true]:border-danger',
);

/** Label + control + hint/error + counter. The control receives `id` and `aria-describedby`. */
export function Field({
  label,
  hint,
  error,
  optional,
  count,
  children,
  className,
  labelHidden,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  /** [used, max] to show "120 / 1,000". */
  count?: [number, number];
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
  className?: string;
  labelHidden?: boolean;
}) {
  const id = useId();
  const help = hint || error || count ? `${id}-help` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={cn('text-sm font-medium text-fg', labelHidden && 'sr-only')}>
        {label}
        {optional ? <span className="font-normal text-fg-3"> · optional</span> : null}
      </label>
      {children({ id, ...(help ? { 'aria-describedby': help } : {}), ...(error ? { 'aria-invalid': true } : {}) })}
      {help ? (
        <div id={help} className="flex items-start justify-between gap-3 text-xs">
          <span className={error ? 'font-medium text-danger-text' : 'text-fg-3'}>{error ?? hint}</span>
          {count ? (
            <span className={cn('shrink-0 tabular-nums', count[0] >= count[1] ? 'text-danger-text' : 'text-fg-3')}>
              {count[0].toLocaleString('en-GB')} / {count[1].toLocaleString('en-GB')}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, type, ...rest },
  ref,
) {
  return <input ref={ref} type={type ?? 'text'} className={cn(controlClass, 'h-9', className)} {...rest} />;
});

/** A textarea; `autoGrow` makes it follow its content up to `maxRows`. */
export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { autoGrow?: boolean; maxRows?: number }
>(function TextArea({ className, autoGrow, maxRows = 12, rows = 3, value, ...rest }, ref) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!autoGrow || !el) return;
    el.style.height = 'auto';
    const line = Number.parseFloat(getComputedStyle(el).lineHeight) || 20;
    const max = line * maxRows + 18;
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
    el.style.overflowY = el.scrollHeight + 2 > max ? 'auto' : 'hidden';
  }, [value, autoGrow, maxRows]);
  return (
    <textarea
      ref={(el) => {
        inner.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      rows={rows}
      value={value}
      className={cn(controlClass, 'py-2 leading-6', autoGrow ? 'resize-none' : 'resize-y', className)}
      {...rest}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <span className="relative inline-flex w-full">
      <select ref={ref} className={cn(controlClass, 'h-9 cursor-pointer appearance-none pr-8', className)} {...rest}>
        {children}
      </select>
      <ChevronDownIcon size={14} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-fg-2" />
    </span>
  );
});

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn('inline-flex cursor-pointer items-center gap-2 text-base text-fg', disabled && 'opacity-60', className)}
    >
      <span className="relative inline-flex h-4 w-4 shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer h-4 w-4 cursor-pointer appearance-none rounded-xs border border-edge-control bg-panel checked:border-accent checked:bg-accent"
        />
        <CheckIcon size={12} className="pointer-events-none absolute top-0.5 left-0.5 hidden text-on-accent peer-checked:block" />
      </span>
      {label}
    </label>
  );
}

export type Choice = { value: string; label: ReactNode; detail?: ReactNode; disabled?: boolean };

/**
 * A group of choices as cards: one (radio) or several (checkbox). Native inputs inside a fieldset
 * with its legend, so the browser gives arrow keys and the screen reader "1 of 3" (R93). The
 * checked card gets the accent edge and a filled mark, not only a color.
 */
export function ChoiceGroup({
  legend,
  legendHidden,
  multiple,
  value,
  onChange,
  choices,
  columns = 1,
  disabled,
  name,
  className,
}: {
  legend: ReactNode;
  legendHidden?: boolean;
  multiple?: boolean;
  value: string[];
  onChange: (value: string[]) => void;
  choices: Choice[];
  columns?: 1 | 2 | 3;
  disabled?: boolean;
  name?: string;
  className?: string;
}) {
  const auto = useId();
  const group = name ?? auto;
  return (
    <fieldset className={cn('flex min-w-0 flex-col gap-2', className)} disabled={disabled}>
      <legend className={cn('mb-1 text-sm font-medium text-fg', legendHidden && 'sr-only')}>{legend}</legend>
      <div className={cn('grid gap-2', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3')}>
        {choices.map((c) => {
          const checked = value.includes(c.value);
          const id = `${group}-${c.value}`;
          return (
            <label
              key={c.value}
              htmlFor={id}
              data-choice={c.value}
              data-checked={checked || undefined}
              className={cn(
                'relative flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors duration-[var(--m-fast)]',
                checked ? 'border-accent bg-accent-soft' : 'border-edge-strong bg-panel hover:border-edge-control hover:bg-hover',
                (c.disabled || disabled) && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                id={id}
                type={multiple ? 'checkbox' : 'radio'}
                name={group}
                value={c.value}
                checked={checked}
                disabled={c.disabled}
                onChange={(e) => {
                  if (multiple) onChange(e.target.checked ? [...value, c.value] : value.filter((v) => v !== c.value));
                  else onChange([c.value]);
                }}
                className={cn(
                  'mt-0.5 h-4 w-4 shrink-0 cursor-pointer appearance-none border border-edge-control bg-panel',
                  multiple
                    ? 'rounded-xs checked:border-accent checked:bg-accent'
                    : 'rounded-full checked:border-[5px] checked:border-accent',
                )}
              />
              {multiple && checked ? (
                <CheckIcon size={12} className="pointer-events-none absolute top-[13px] left-[14px] text-on-accent" />
              ) : null}
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium text-fg">{c.label}</span>
                {c.detail ? <span className="text-sm text-fg-2">{c.detail}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
