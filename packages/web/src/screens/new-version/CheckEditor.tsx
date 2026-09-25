// One check of the new version: Keep, Change or Drop for those of the base version, as the design
// system's Choice (each option says what it changes); a new one is edited right away. Who checks it
// is two of its Chips. Leaving the statement field checks how verifiable it is, without blocking.

import { Chip, Choice } from '@demiurgo/design-system';
import { useId, useState } from 'react';
import { cn } from '../../lib/cn.ts';
import { Button } from '../../ui/Button.tsx';
import { Code } from '../../ui/Card.tsx';
import { TypeIcon, WarningIcon } from '../../ui/icons.tsx';
import { VerificationMark } from '../record/Checks.tsx';
import type { CheckDraft, Choice as Carry, Verification } from './form.ts';
import { statementWarnings } from './verifiability.ts';

/** What happens to a check of the base version, and what choosing it changes. */
const CARRY: { value: Carry; label: string; effect: string }[] = [
  { value: 'keep', label: 'Keep', effect: 'It goes into the new version as it is.' },
  { value: 'change', label: 'Change', effect: 'You edit it here, under the same code.' },
  { value: 'drop', label: 'Drop', effect: 'It leaves the new version and stays in the earlier ones.' },
];

const WHO: { value: Verification; label: string }[] = [
  { value: 'automatic', label: 'Automatic' },
  { value: 'manual', label: 'You' },
];

const FRAME =
  'w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-ink placeholder:text-muted focus:border-needs focus:outline-none';
/** A text field in the body style. */
export const field = `dm-text-body ${FRAME}`;
/** The title field, in the heading style. */
export const titleField = `dm-text-heading ${FRAME}`;

function Editor({ check, onChange }: { check: CheckDraft; onChange: (c: CheckDraft) => void }) {
  const id = useId();
  // The warning appears when leaving the statement field (and follows it on every later blur).
  const [left, setLeft] = useState<string | null>(null);
  const warnings = left === null ? [] : statementWarnings(left);
  return (
    <div className="flex flex-col gap-3 border-t border-line-soft pt-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-title`} className="dm-text-caption font-semibold text-ink-2">
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
        <label htmlFor={`${id}-statement`} className="dm-text-caption font-semibold text-ink-2">
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
            className="dm-text-caption rounded-control bg-problem-tint px-3 py-2 text-problem"
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
          <label htmlFor={`${id}-check`} className="dm-text-caption font-semibold text-ink-2">
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
          <span id={`${id}-who`} className="dm-text-caption font-semibold text-ink-2">
            Who checks it
          </span>
          <div role="group" aria-labelledby={`${id}-who`} className="flex items-center gap-2 py-1">
            {WHO.map((o) => (
              <Chip
                key={o.value}
                pressed={check.verification === o.value}
                onClick={() => onChange({ ...check, verification: o.value })}
              >
                {o.label}
              </Chip>
            ))}
          </div>
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
        'flex flex-col gap-3 rounded-card-md border bg-surface px-4 py-3',
        isNew ? 'border-needs-ring' : check.choice === null ? 'border-line-strong border-dashed' : 'border-line',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="dm-label flex items-center gap-1.5">
            <TypeIcon kind="check" size={13} />
            {isNew ? 'New check' : `Check ${index + 1}`}
            {check.code && <Code className="tracking-normal normal-case">{check.code}</Code>}
          </span>
          {!isNew && (
            <strong className={cn('dm-text-body font-semibold', dropped && 'text-muted line-through')}>{check.title}</strong>
          )}
        </div>
        {isNew && (
          <Button variant="text" onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>
      {!isNew && check.choice !== 'change' && (
        <div className="-mt-1 flex items-start justify-between gap-3">
          <p className={cn('dm-text-small text-ink-2', dropped && 'text-muted line-through')}>{check.statement}</p>
          {!dropped && (
            <span className="shrink-0">
              <VerificationMark verification={check.verification} />
            </span>
          )}
        </div>
      )}
      {!isNew && (
        <Choice
          aria-label={`What to do with ${check.title} (${check.code})`}
          options={CARRY.map(({ label, effect }) => ({ label, effect }))}
          {...(check.choice ? { value: CARRY.find((c) => c.value === check.choice)?.label ?? '' } : {})}
          onChange={(label) => {
            const choice = CARRY.find((c) => c.label === label)?.value;
            if (choice) onChange({ ...check, choice });
          }}
        />
      )}
      {(isNew || check.choice === 'change') && <Editor check={check} onChange={onChange} />}
    </li>
  );
}
