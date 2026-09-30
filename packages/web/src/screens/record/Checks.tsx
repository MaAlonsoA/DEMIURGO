// The checks of a version (its acceptance criteria; DESIGN.md §3.6, INV-REC-17, INV-BP-28): one row
// each, in a single column so long Given/When/Then statements read comfortably — title, statement,
// how it is checked, who checks it (Automatic or You, in words) and its code, with the verifiability
// warnings of the readiness under the statement. On the current approved version each check says
// whether it has evidence (how the person checked it, once built) and lets them record it.

import { type FormEvent, useId, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import type { Criterion, Readiness } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Code } from '../../components/Badge.tsx';
import { checkAnchor, isUntied } from '../../components/BehaviorSteps.tsx';
import { BEHAVIOR_STEPS } from '../../components/words.i18n.ts';
import { Button } from '../../components/Button.tsx';
import { Field, TextArea, TextInput } from '../../components/Field.tsx';
import { AlertTriangleIcon, CheckCircleIcon, CircleDashedIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { Who, WhoAvatar } from '../../components/Who.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useLocale } from '../../i18n/locale.ts';
import { cn } from '../../lib/cn.ts';
import { shortDate } from '../../lib/time.ts';
import { warningsOf } from './logic.ts';
import { CHECKS } from './words.i18n.ts';

/** Who checks it: a test on its own (Automatic) or the person by hand (You), in words. */
export function VerificationMark({ verification, className }: { verification: string; className?: string }) {
  const t = useMessages(CHECKS);
  const you = verification === 'manual';
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs text-fg-2', className)}
      title={you ? t.verifyManualTitle : t.verifyAutoTitle}
    >
      <WhoAvatar kind={you ? 'you' : 'automatic'} size={16} />
      <span>
        {t.checkedBy}
        <span className="font-medium text-fg">{you ? t.you : t.automatic}</span>
      </span>
    </span>
  );
}

/** Where evidence can be recorded: the current approved version of a record, by a person. */
export type Recording = { projectId: string; version: number } | null;

/** The evidence of a check: who checked it, how and when, or that it is not checked yet. */
function EvidenceLine({ criterion: c, recording }: { criterion: Criterion; recording: Recording }) {
  const t = useMessages(CHECKS);
  const locale = useLocale();
  const command = useCommand(recording?.projectId ?? '');
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [reference, setReference] = useState('');
  const e = c.evidence ?? null;
  if (!e && !recording) return null;
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const data = { criterion_id: c.id, note: note.trim(), ...(reference.trim() ? { reference: reference.trim() } : {}) };
    command.mutate(
      { command: 'evidence.record_manual', data },
      {
        onSuccess: () => {
          announce(t.recorded(c.code));
          setOpen(false);
          setNote('');
          setReference('');
        },
      },
    );
  };
  return (
    <div data-evidence={e ? 'checked' : 'unchecked'} className="flex flex-col gap-2 border-t border-edge-subtle pt-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {e ? (
          <>
            <span className="inline-flex items-center gap-1.5 font-medium text-success-text">
              <CheckCircleIcon size={14} />
              {t.checked}
            </span>
            {c.verification === 'automatic' && e.kind === 'manual' ? <span className="text-fg-2">{t.byHand}</span> : null}
            {recording && e.version !== recording.version ? <span className="text-fg-2">{t.inherited(e.version)}</span> : null}
            <span className="inline-flex items-center gap-1.5 text-xs text-fg-3">
              <Who actor={e.by} size={16} />
              {shortDate(e.at, locale)}
            </span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-fg-2">
            <CircleDashedIcon size={14} />
            {t.notChecked}
          </span>
        )}
        {recording && !open ? (
          <Button size="sm" variant={e ? 'quiet' : 'secondary'} className="ml-auto" onClick={() => setOpen(true)}>
            {e ? t.recordAgain : t.record}
          </Button>
        ) : null}
      </div>
      {e ? (
        <p className="text-fg">
          {e.note}
          {e.reference ? <span className="ml-2 font-mono text-xs text-fg-2">{e.reference}</span> : null}
        </p>
      ) : null}
      {open ? (
        <form onSubmit={submit} className="flex flex-col gap-3" data-evidence-form>
          <Field label={t.note} hint={t.noteHint}>
            {(p) => (
              <TextArea {...p} value={note} maxLength={2000} required autoGrow onChange={(x) => setNote(x.target.value)} />
            )}
          </Field>
          <Field label={t.reference} optional>
            {(p) => <TextInput {...p} value={reference} maxLength={500} onChange={(x) => setReference(x.target.value)} />}
          </Field>
          {command.error ? <ErrorNotice error={command.error} /> : null}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" pending={command.isPending} pendingLabel={t.saving}>
              {t.save}
            </Button>
            <Button type="button" variant="quiet" size="sm" onClick={() => setOpen(false)}>
              {t.cancel}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function CheckList({
  criteria,
  readiness,
  recording = null,
  steps = 0,
}: {
  criteria: Criterion[];
  readiness: Readiness | null;
  recording?: Recording;
  /** How many Behavior steps the record has; checks not tied to one say so. */
  steps?: number;
}) {
  const t = useMessages(CHECKS);
  const ts = useMessages(BEHAVIOR_STEPS);
  if (criteria.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-edge-strong px-4 py-6 text-center text-sm text-fg-2">
        {t.noChecksYet}
      </p>
    );
  }
  return (
    <ol className="flex flex-col divide-y divide-edge-subtle border-y border-edge-subtle">
      {criteria.map((c) => {
        const warnings = warningsOf(c.code, readiness);
        return (
          <li key={c.id} id={checkAnchor(c.code)} data-check={c.code} className="flex scroll-mt-16 flex-col gap-1.5 py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Code>{c.code}</Code>
              <h3 className="text-md font-semibold text-fg">{c.title}</h3>
              {isUntied(c, steps) ? <span className="text-xs text-fg-3">{ts.notTiedToStep}</span> : null}
            </div>
            <p className="text-sm text-fg-2">{c.statement}</p>
            {warnings.length > 0 ? (
              <div
                data-verifiability
                className="flex items-start gap-2 rounded-md border border-warning-edge bg-warning-soft px-3 py-2 text-sm text-fg"
              >
                <AlertTriangleIcon size={14} className="mt-0.5 shrink-0 text-warning-text" />
                <ul className="flex flex-col gap-0.5">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-edge-subtle pt-2 text-sm text-fg-2">
              <span>
                <span className="font-medium text-fg">{t.how}</span>
                {c.check}
              </span>
              <VerificationMark verification={c.verification} className="ml-auto" />
            </div>
            <EvidenceLine criterion={c} recording={recording} />
          </li>
        );
      })}
    </ol>
  );
}

/** The checks with their heading, as a section of the record's overview or its own tab. */
export function Checks({
  criteria,
  readiness,
  level = 2,
  recording = null,
  steps = 0,
}: {
  criteria: Criterion[];
  readiness: Readiness | null;
  level?: 2 | 3;
  recording?: Recording;
  steps?: number;
}) {
  const t = useMessages(CHECKS);
  const id = useId();
  const H = level === 3 ? 'h3' : 'h2';
  const checked = criteria.filter((c) => c.evidence).length;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <H id={id} className="text-lg font-semibold text-fg">
        {t.checksTitle}{' '}
        {recording || checked > 0 ? (
          <span className="font-normal text-fg-2">· {t.progress(checked, criteria.length)}</span>
        ) : (
          <span className="font-normal text-fg-2">· {criteria.length}</span>
        )}
      </H>
      <CheckList criteria={criteria} readiness={readiness} recording={recording} steps={steps} />
    </section>
  );
}
