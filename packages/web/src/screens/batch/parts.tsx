// The pieces the proposal view, the batch pages and Needs you share (DESIGN.md §3.1.1, §3.2): a
// record chip (title first, code small), checks as structured rows, record sections as prose, the
// idea check, the run that drafted something, the out-of-date and blocked notices, and the
// decision bar that stays at the bottom of what it decides (R13, R67).

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useId, useState } from 'react';
import { runQuery } from '../../api/queries.ts';
import type { IdeaAssessmentSummary, ProductRow } from '../../api/types.ts';
import { Code } from '../../components/Badge.tsx';
import { ArrowRightIcon, ChevronDownIcon, ChevronRightIcon } from '../../components/icons.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { Notice } from '../../components/Notice.tsx';
import { EntityState, StateText, StatusBadge, WorkingDot } from '../../components/status.tsx';
import { DayTime } from '../../components/Time.tsx';
import { TypeIcon, typeOfCode } from '../../components/types.tsx';
import { Who, WhoAvatar } from '../../components/Who.tsx';
import { cn } from '../../lib/cn.ts';
import { between } from '../../lib/time.ts';
import { ACTION_WORDS } from '../../words.ts';
import { citedRecord, FINDING_WORDS, rowOf } from './model.ts';
import type { PayloadCheck, PayloadSection } from './proposal.ts';

export const linkClass = 'font-medium text-accent-text underline-offset-2 hover:underline';

/** A record: its name first, then its code (and version) small in mono; it opens the record. */
export function RecordChip({
  projectId,
  code,
  version,
  rows,
  className,
}: {
  projectId: string;
  code: string;
  version?: number | null;
  rows: readonly ProductRow[];
  className?: string;
}) {
  const row = rowOf(rows, code);
  const type = row?.type ?? typeOfCode(code);
  return (
    <Link
      to="/p/$projectId/records/$code"
      params={{ projectId, code }}
      search={version ? { v: version } : {}}
      data-record-chip={code}
      className={cn(
        'inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-md border border-edge bg-panel px-2 py-0.5 text-sm text-fg hover:border-edge-strong hover:bg-hover',
        className,
      )}
    >
      {type ? <TypeIcon type={type} size={13} className="shrink-0 text-fg-3" /> : null}
      {row ? <span className="truncate font-medium">{row.title}</span> : null}
      <Code className="shrink-0">
        {code}
        {version ? ` v${version}` : ''}
      </Code>
    </Link>
  );
}

/** Who verifies a check: an automatic test, or the person once it is built. */
function Verification({ verification }: { verification: string }) {
  const automatic = verification === 'automatic';
  return (
    <span className="inline-flex items-center gap-1.5">
      <WhoAvatar kind={automatic ? 'automatic' : 'you'} size={16} />
      {automatic ? 'Verified automatically' : 'You verify it'}
    </span>
  );
}

/** Checks as structured rows: what must be true, how it is checked and who verifies it (R67). */
export function ChecksList({ checks, className }: { checks: PayloadCheck[]; className?: string }) {
  return (
    <ol className={cn('flex flex-col divide-y divide-edge-subtle rounded-lg border border-edge bg-panel', className)}>
      {checks.map((c, i) => (
        <li key={c.code ?? `${c.title}-${i}`} className="flex flex-col gap-1 px-3.5 py-3" data-check={c.code ?? i}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="font-medium text-fg">{c.title}</p>
            {c.code ? <Code>{c.code}</Code> : null}
          </div>
          <p className="text-sm text-fg-2">{c.statement}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-2">
            <span>
              <span className="text-fg-3">Check: </span>
              {c.check}
            </span>
            <Verification verification={c.verification} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Sections of a record as they were written, as prose. */
export function Sections({ sections, level = 3 }: { sections: PayloadSection[]; level?: 3 | 4 }) {
  const H = level === 4 ? 'h4' : 'h3';
  return (
    <div className="flex flex-col gap-4">
      {sections.map((s, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: sections may repeat a title
        <section key={`${s.title}-${i}`} className="flex flex-col gap-1">
          {s.title ? <H className="text-sm font-semibold text-fg-2">{s.title}</H> : null}
          {s.content ? <Markdown>{s.content}</Markdown> : <p className="text-sm text-fg-3">Empty.</p>}
        </section>
      ))}
    </div>
  );
}

/** A titled block of evidence inside a proposal ("Starts from", "Checked against…"). */
export function Evidence({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn('flex flex-col gap-1.5', className)}>
      <h3 id={id} className="text-sm font-semibold text-fg-2">
        {title}
      </h3>
      {children}
    </section>
  );
}

type Finding = { finding?: string; verdict?: string; citation?: string; justification?: string };

const URGENT = new Set(['conflicts', 'duplicates', 'inconsistent']);

/** What the idea check found against what DEMIURGO knows (INV-PROP-12). */
export function IdeaCheck({
  projectId,
  assessment,
  rows,
}: {
  projectId: string;
  assessment: IdeaAssessmentSummary | null | undefined;
  rows: readonly ProductRow[];
}) {
  if (!assessment) return null;
  const pending = assessment.pending === true;
  const error = typeof assessment.error === 'string' ? assessment.error : null;
  const findings = ((assessment.findings ?? []) as Finding[]).filter((f) => (f.finding ?? f.verdict) !== 'none');
  const codes = rows.map((r) => r.code);
  return (
    <Evidence title="Checked against what DEMIURGO knows">
      <div data-idea-check className="text-sm">
        {pending ? (
          <p className="inline-flex items-center gap-2 text-fg-2">
            <WorkingDot /> Checking it…
          </p>
        ) : error ? (
          <p className="text-danger-text">The check couldn&apos;t run: {error}</p>
        ) : findings.length === 0 ? (
          <p className="text-fg-2">It doesn&apos;t repeat or contradict anything DEMIURGO knows.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {findings.map((f) => {
              const verdict = f.finding ?? f.verdict ?? '';
              const cited = f.citation ? citedRecord(f.citation, codes) : null;
              const word = FINDING_WORDS[verdict] ?? verdict;
              return (
                <li key={`${verdict}-${f.citation}`} className="flex flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    {URGENT.has(verdict) ? (
                      <StateText kind="conflict" word={word} className="font-medium" />
                    ) : (
                      <span className="font-medium text-fg">{word}</span>
                    )}
                    {cited ? (
                      <RecordChip projectId={projectId} code={cited.code} version={cited.version} rows={rows} />
                    ) : (
                      <Code>{f.citation}</Code>
                    )}
                  </span>
                  {f.justification ? <span className="text-fg-2">{f.justification}</span> : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Evidence>
  );
}

/** "Drafted by DEMIURGO · model · Completed · Thu 18:52 · took 1:04 · Open the run" (R22, R11). */
export function RunLine({ projectId, runId, className }: { projectId: string; runId: string; className?: string }) {
  const run = useQuery(runQuery(projectId, runId)).data;
  return (
    <div
      data-run-line={runId}
      className={cn(
        'flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-edge bg-sunken px-3.5 py-2 text-sm',
        className,
      )}
    >
      {run ? (
        <>
          <Who actor={`agent:run:${run.id}`} model={run.model} size={18} className="font-medium text-fg" />
          <span className="text-fg-2">
            {run.action === 'design_proposal' ? 'Drafted it' : (ACTION_WORDS[run.action] ?? run.action)}
          </span>
          <EntityState entity="ai_run" state={run.state} />
          <span className="text-fg-2">
            <DayTime iso={run.created_at} />
            {run.started_at && run.finished_at ? ` · took ${between(run.started_at, run.finished_at)}` : ''}
          </span>
        </>
      ) : (
        <span className="text-fg-3">The run that drafted it…</span>
      )}
      <Link
        to="/p/$projectId/runs/$runId"
        params={{ projectId, runId }}
        className={cn(linkClass, 'ml-auto inline-flex min-h-6 items-center gap-1')}
      >
        Open the run <ArrowRightIcon size={13} />
      </Link>
    </div>
  );
}

/** A superseded proposal or package: the clock, "Out of date", and why (INV-PROP-14). */
export function OutOfDate({ title = 'Out of date', children }: { title?: string; children?: ReactNode }) {
  return (
    <div data-out-of-date className="flex flex-col gap-1.5 rounded-lg border border-warning-edge bg-warning-soft px-3.5 py-3">
      <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
        <StatusBadge kind="stale" word="Out of date" />
        {title !== 'Out of date' ? <span>{title}</span> : null}
      </p>
      {children ? <div className="text-base text-fg-2">{children}</div> : null}
    </div>
  );
}

/** The server says accepting would fail now: why, above the decision (INV-PROP-13, R76). */
export function BlockedNotice({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <Notice tone="warning" title="It can't be accepted as it is">
      <ul className="list-disc space-y-0.5 pl-5">
        {reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </Notice>
  );
}

/**
 * The decision of what is above it: its buttons, a caption, and the error of the last action. Sticky
 * at the bottom of its column, so the decision is never far from what it approves (INVENTORY Part D
 * §3, UX problem).
 */
export function DecisionBar({
  children,
  caption,
  error,
  sticky = true,
  label = 'Decide',
  className,
}: {
  children: ReactNode;
  caption?: ReactNode;
  error?: ReactNode;
  sticky?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-decision-bar
      className={cn('flex flex-col gap-2 border-t border-edge bg-panel pt-3 pb-4', sticky && 'sticky bottom-0 z-10', className)}
    >
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {caption ? <div className="text-sm text-fg-2">{caption}</div> : null}
      {error}
    </div>
  );
}

/** A small disclosure ("What's the difference?"): the button says whether it is open. */
export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-6 w-fit cursor-pointer items-center gap-1 rounded-xs text-sm font-medium text-accent-text hover:underline"
      >
        {open ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
        {label}
      </button>
      <div id={id} hidden={!open} className="max-w-prose text-sm text-fg-2">
        {children}
      </div>
    </div>
  );
}
