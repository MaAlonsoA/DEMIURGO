// One check of a form (DESIGN.md §3.6, INV-NEWVER-07/08, INV-NEWREC-08). A check of the base
// version gets an explicit Keep, Change or Drop, each saying what it does; Change opens its editor
// under the same code. A new check is edited right away and can be removed. Who checks it is a
// choice of two (Automatic, You). Leaving the statement checks how verifiable it is, without
// blocking. Edits made under Change are kept if the person picks Keep or Drop and comes back.

import { useId, useState } from 'react';
import { Code } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { ChoiceGroup, Field, TextArea, TextInput } from '../../components/Field.tsx';
import { AlertTriangleIcon, TrashIcon } from '../../components/icons.tsx';
import { useMessages } from '../../i18n/define.ts';
import { cn } from '../../lib/cn.ts';
import { VerificationMark } from '../record/Checks.tsx';
import type { CheckDraft, Choice as Carry, Verification } from './form.ts';
import { statementWarnings } from './verifiability.ts';
import { CHECK_EDITOR } from './words.i18n.ts';

function Editor({ check, onChange }: { check: CheckDraft; onChange: (c: CheckDraft) => void }) {
  const t = useMessages(CHECK_EDITOR);
  // The warning appears when leaving the statement field (and follows it on every later blur).
  const [left, setLeft] = useState<string | null>(null);
  const warnings = left === null ? [] : statementWarnings(left);
  const warningsId = useId();
  const WHO: { value: Verification; label: string; detail: string }[] = [
    { value: 'automatic', label: t.automatic, detail: t.automaticDetail },
    { value: 'manual', label: t.you, detail: t.youDetail },
  ];
  return (
    <div className="flex flex-col gap-4 border-t border-edge-subtle pt-4">
      <Field label={t.title} count={[check.title.length, 200]}>
        {(p) => (
          <TextInput {...p} value={check.title} maxLength={200} onChange={(e) => onChange({ ...check, title: e.target.value })} />
        )}
      </Field>
      <div className="flex flex-col gap-2">
        <Field label={t.statement} hint={t.statementHint} count={[check.statement.length, 3000]}>
          {(p) => (
            <TextArea
              {...p}
              aria-describedby={cn(p['aria-describedby'], warnings.length > 0 && warningsId) || undefined}
              autoGrow
              rows={3}
              value={check.statement}
              maxLength={3000}
              onChange={(e) => onChange({ ...check, statement: e.target.value })}
              onBlur={(e) => setLeft(e.target.value)}
            />
          )}
        </Field>
        {warnings.length > 0 ? (
          <div
            id={warningsId}
            data-verifiability
            role="status"
            className="flex items-start gap-2 rounded-md border border-warning-edge bg-warning-soft px-3 py-2 text-sm text-fg"
          >
            <AlertTriangleIcon size={14} className="mt-0.5 shrink-0 text-warning-text" />
            <div className="flex flex-col gap-0.5">
              <p className="font-medium">{t.hardToVerify}</p>
              <ul className="list-disc pl-5 text-fg-2">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>
      <Field label={t.howItIsChecked} count={[check.check.length, 1000]}>
        {(p) => (
          <TextInput
            {...p}
            value={check.check}
            maxLength={1000}
            onChange={(e) => onChange({ ...check, check: e.target.value })}
          />
        )}
      </Field>
      <ChoiceGroup
        legend={t.whoChecksIt}
        columns={2}
        value={[check.verification]}
        onChange={([v]) => v && onChange({ ...check, verification: v as Verification })}
        choices={WHO.map((w) => ({ value: w.value, label: w.label, detail: w.detail }))}
      />
    </div>
  );
}

export function CheckEditor({
  check,
  index,
  onChange,
  onRemove,
  editsKept,
}: {
  check: CheckDraft;
  index: number;
  onChange: (c: CheckDraft) => void;
  onRemove: () => void;
  /** Edits made under Change are waiting to come back if Change is chosen again. */
  editsKept?: boolean;
}) {
  const t = useMessages(CHECK_EDITOR);
  const CARRY: { value: Carry; label: string; effect: string }[] = [
    { value: 'keep', label: t.keep, effect: t.keepEffect },
    { value: 'change', label: t.change, effect: t.changeEffect },
    { value: 'drop', label: t.drop, effect: t.dropEffect },
  ];
  const isNew = check.code === null;
  const dropped = check.choice === 'drop';
  return (
    <li
      data-criterion={check.key}
      className={cn(
        'flex flex-col gap-3 rounded-lg border bg-panel p-4',
        isNew ? 'border-accent-edge' : check.choice === null ? 'border-dashed border-edge-strong' : 'border-edge',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-fg-2">
            {isNew ? t.newCheck : t.checkN(index + 1)}
            {check.code ? <Code>{check.code}</Code> : null}
          </p>
          {!isNew ? (
            <h3 className={cn('text-base font-semibold text-fg', dropped && 'text-fg-2 line-through')}>{check.title}</h3>
          ) : null}
        </div>
        {isNew ? (
          <Button
            size="sm"
            variant="quiet-danger"
            icon={<TrashIcon size={14} />}
            onClick={onRemove}
            aria-label={t.removeTheNewCheck}
          >
            {t.remove}
          </Button>
        ) : null}
      </div>
      {!isNew && check.choice !== 'change' ? (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <p className={cn('min-w-0 flex-1 basis-64 text-sm text-fg', dropped && 'text-fg-2 line-through')}>{check.statement}</p>
          {!dropped ? <VerificationMark verification={check.verification} /> : null}
        </div>
      ) : null}
      {!isNew ? (
        <ChoiceGroup
          legend={t.whatToDoWith(check.title, check.code ?? '')}
          legendHidden
          columns={3}
          value={check.choice ? [check.choice] : []}
          onChange={([v]) => v && onChange({ ...check, choice: v as Carry })}
          choices={CARRY.map((c) => ({ value: c.value, label: c.label, detail: c.effect }))}
        />
      ) : null}
      {editsKept && check.choice !== 'change' ? <p className="text-xs text-fg-2">{t.editsKept}</p> : null}
      {isNew || check.choice === 'change' ? <Editor check={check} onChange={onChange} /> : null}
    </li>
  );
}
