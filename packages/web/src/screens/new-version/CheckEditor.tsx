// One check of the new version: Keep, Change or Drop for those of the base version; a new one is
// edited right away. Leaving the statement field checks how verifiable it is, without blocking.

import { useId, useState } from 'react';
import { cn } from '../../lib/cn.ts';
import { Button } from '../../ui/Button.tsx';
import { Code } from '../../ui/Card.tsx';
import { TypeIcon, WarningIcon } from '../../ui/icons.tsx';
import { VerificationMark } from '../record/Checks.tsx';
import type { CheckDraft, Choice, Verification } from './form.ts';
import { statementWarnings } from './verifiability.ts';

type Option<T extends string> = { value: T; label: string };

/** Radio buttons drawn as a segmented control: real inputs, so the keyboard and screen readers work as usual. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = 'md',
}: {
  label: string;
  value: T | null;
  options: Option<T>[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex shrink-0 rounded-[var(--radius-control)] border border-line-strong bg-surface p-0.5"
    >
      {options.map((o) => (
        <label key={o.value} className="relative inline-flex">
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="peer absolute inset-0 cursor-pointer appearance-none rounded-[6px]"
          />
          <span
            className={cn(
              'pointer-events-none relative rounded-[6px] font-medium text-ink-2 peer-checked:bg-ink peer-checked:text-white peer-hover:text-ink peer-checked:peer-hover:text-white',
              size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-[13px]',
            )}
          >
            {o.label}
          </span>
        </label>
      ))}
    </div>
  );
}

const CHOICES: Option<Choice>[] = [
  { value: 'keep', label: 'Keep' },
  { value: 'change', label: 'Change' },
  { value: 'drop', label: 'Drop' },
];

const WHO: Option<Verification>[] = [
  { value: 'automatic', label: 'Automatic' },
  { value: 'manual', label: 'You' },
];

export const field =
  'w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-needs focus:outline-none';

function Editor({ check, onChange }: { check: CheckDraft; onChange: (c: CheckDraft) => void }) {
  const id = useId();
  // The warning appears when leaving the statement field (and follows it on every later blur).
  const [left, setLeft] = useState<string | null>(null);
  const warnings = left === null ? [] : statementWarnings(left);
  return (
    <div className="flex flex-col gap-3 border-t border-line-soft pt-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-title`} className="text-xs font-semibold text-ink-2">
          Title
        </label>
        <input
          id={`${id}-title`}
          value={check.title}
          maxLength={200}
          onChange={(e) => onChange({ ...check, title: e.target.value })}
          className={field}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-statement`} className="text-xs font-semibold text-ink-2">
          Statement <span className="font-normal text-muted">· given…, when…, then…</span>
        </label>
        <textarea
          id={`${id}-statement`}
          value={check.statement}
          rows={3}
          maxLength={3000}
          onChange={(e) => onChange({ ...check, statement: e.target.value })}
          onBlur={(e) => setLeft(e.target.value)}
          aria-describedby={warnings.length ? `${id}-warnings` : undefined}
          className={field}
        />
        {warnings.length > 0 && (
          <div
            id={`${id}-warnings`}
            data-verifiability
            role="status"
            className="rounded-[var(--radius-control)] border border-problem-line bg-problem-bg px-3 py-2 text-xs text-problem"
          >
            <p className="flex items-center gap-1.5 font-semibold">
              <WarningIcon size={13} className="shrink-0" />
              It may be hard to verify. You can save it anyway.
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-6">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="flex items-end gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={`${id}-check`} className="text-xs font-semibold text-ink-2">
            How it is checked
          </label>
          <input
            id={`${id}-check`}
            value={check.check}
            maxLength={1000}
            onChange={(e) => onChange({ ...check, check: e.target.value })}
            className={field}
          />
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <span className="text-xs font-semibold text-ink-2" aria-hidden="true">
            Who checks it
          </span>
          <Segmented
            label="Who checks it"
            value={check.verification}
            options={WHO}
            onChange={(v) => onChange({ ...check, verification: v })}
          />
        </div>
      </div>
    </div>
  );
}

export function CheckEditor({
  check,
  index,
  onChange,
  onRemove,
}: {
  check: CheckDraft;
  index: number;
  onChange: (c: CheckDraft) => void;
  onRemove: () => void;
}) {
  const isNew = check.code === null;
  const dropped = check.choice === 'drop';
  return (
    <li
      data-criterion={check.key}
      className={cn(
        'flex flex-col gap-2 rounded-[var(--radius-card)] border bg-surface px-4 py-3',
        isNew ? 'border-needs-ring' : check.choice === null ? 'border-line-strong border-dashed' : 'border-line',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
            <TypeIcon kind="check" size={13} />
            {isNew ? 'New check' : `Check ${index + 1}`}
            {check.code && <Code className="tracking-normal normal-case">{check.code}</Code>}
          </span>
          {!isNew && (
            <strong className={cn('text-[14px] leading-snug font-semibold', dropped && 'text-muted line-through')}>
              {check.title}
            </strong>
          )}
        </div>
        {isNew ? (
          <Button variant="ghost" size="sm" onClick={onRemove}>
            Remove
          </Button>
        ) : (
          <Segmented
            label={`What to do with ${check.title} (${check.code})`}
            value={check.choice}
            options={CHOICES}
            onChange={(choice) => onChange({ ...check, choice })}
          />
        )}
      </div>
      {!isNew && check.choice !== 'change' && (
        <div className="flex items-start justify-between gap-3">
          <p className={cn('text-[13px] leading-relaxed text-ink-2', dropped && 'text-muted line-through')}>{check.statement}</p>
          {!dropped && (
            <span className="shrink-0">
              <VerificationMark verification={check.verification} />
            </span>
          )}
        </div>
      )}
      {dropped && <p className="text-xs text-muted">It is dropped from the new version and stays in the earlier ones.</p>}
      {(isNew || check.choice === 'change') && <Editor check={check} onChange={onChange} />}
    </li>
  );
}
