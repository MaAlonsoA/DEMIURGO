// Small pieces of the package and batch page (canvas S7B and S5A): the eyebrow, the "What it
// changes" box, chips, checks, sections, the idea check and the out-of-date box.

import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { IdeaAssessmentSummary, ProductRow } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { Code } from '../../ui/Card.tsx';
import { TypeIcon, type IconKind, WarningIcon } from '../../ui/icons.tsx';
import { Markdown } from '../../ui/Markdown.tsx';
import { Mark } from '../../ui/marks.tsx';
import { WhoMark } from '../../ui/signals.tsx';
import { citedRecord, FINDING_WORDS, rowOf } from './model.ts';

/** Small uppercase line above a title: "1 OF 4 · NEW CHECK · ○ Proposed". */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1.5 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Dot() {
  return (
    <span className="text-inactive-light" aria-hidden="true">
      ·
    </span>
  );
}

/** The normal-case part of an eyebrow (a mark and its word). */
export function EyebrowWord({ children }: { children: ReactNode }) {
  return <span className="tracking-normal normal-case">{children}</span>;
}

export function TypeLabel({ icon, children }: { icon: IconKind; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <TypeIcon kind={icon} size={13} />
      {children}
    </span>
  );
}

/** The warm box of "What it changes". */
export function ChangeBox({ title = 'What it changes', children }: { title?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-[10px] bg-surface-2 px-3.5 py-2.5">
      <span className="text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">{title}</span>
      {children}
    </div>
  );
}

/** A field of a proposal as it came: its label and its text. */
export function Field({ label, children, mark = true }: { label: string; children: ReactNode; mark?: boolean }) {
  return (
    <div className="flex items-start gap-2 text-[13.5px] leading-[1.45]">
      <span className="flex w-3.5 shrink-0 justify-center pt-[5px]">{mark ? <Mark kind="proposed" size={9} /> : null}</span>
      <div className="min-w-0 flex-1">
        <span className="text-muted">{label}: </span>
        <span className="whitespace-pre-line text-ink">{children}</span>
      </div>
    </div>
  );
}

/** A record chip: its name first, then its code small and in mono; it links to the record. */
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
  return (
    <Link
      to="/p/$projectId/records/$code"
      params={{ projectId, code }}
      search={version ? { v: version } : {}}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-0.5 text-[12.5px] font-semibold text-ink hover:border-line-strong',
        className,
      )}
    >
      {row && <span className="truncate">{row.title}</span>}
      <Code className="shrink-0">
        {code}
        {version ? ` v${version}` : ''}
      </Code>
    </Link>
  );
}

export type CheckLike = { code?: string; title: string; statement: string; verification: string; check: string };

/** Who checks it: Automatic (a test) or You (by hand, once built). */
export function Verification({ verification }: { verification: string }) {
  const automatic = verification === 'automatic';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      <WhoMark actor={automatic ? 'system:test' : 'human:you'} size={16} />
      {automatic ? 'Automatic' : 'You'}
    </span>
  );
}

/** Checks as a dense list (imported documents can have many). */
export function ChecksList({ checks }: { checks: CheckLike[] }) {
  return (
    <ol className="flex flex-col divide-y divide-line-soft rounded-[10px] border border-line bg-surface">
      {checks.map((c, i) => (
        <li key={c.code ?? `${c.title}-${i}`} className="flex flex-col gap-1 px-3.5 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-baseline gap-2">
              <strong className="text-[13.5px] font-semibold">{c.title}</strong>
              {c.code ? <Code>{c.code}</Code> : <span className="text-xs text-muted">Check {i + 1}</span>}
            </span>
            <Verification verification={c.verification} />
          </div>
          <p className="text-[13px] leading-snug text-ink-2">{c.statement}</p>
          <p className="text-xs text-muted">
            <span className="font-semibold">Check:</span> {c.check}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** Checks as cards (canvas S5A), for a short list. */
export function CheckCards({ checks }: { checks: CheckLike[] }) {
  return (
    <ol className="grid grid-cols-2 gap-3">
      {checks.map((c, i) => (
        <li
          key={c.code ?? `${c.title}-${i}`}
          className="flex flex-col gap-1.5 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3"
        >
          <Eyebrow>
            <TypeLabel icon="check">Check {i + 1}</TypeLabel>
            {c.code && <Code className="tracking-normal normal-case">{c.code}</Code>}
          </Eyebrow>
          <strong className="text-[14px] leading-snug font-semibold">{c.title}</strong>
          <p className="text-[13px] leading-snug text-ink-2">{c.statement}</p>
          <p className="text-xs text-muted">
            <span className="font-semibold">Check:</span> {c.check}
          </p>
          <div className="mt-auto border-t border-line-soft pt-2">
            <Verification verification={c.verification} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Sections of a record as they were written. */
export function Sections({ sections, level = 3 }: { sections: { title: string; content: string }[]; level?: 2 | 3 }) {
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <div className="flex flex-col gap-4">
      {sections.map((s) => (
        <section key={s.title} className="flex flex-col gap-1">
          <H className="text-[13px] font-semibold text-ink-2">{s.title}</H>
          <Markdown>{s.content}</Markdown>
        </section>
      ))}
    </div>
  );
}

type Finding = { finding?: string; verdict?: string; citation?: string; justification?: string; confidence?: number };

/** What the idea check found against what DEMIURGO knows (duplicates, contradicts or relates). */
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
    <div className="flex items-start gap-2.5" data-idea-check>
      <WhoMark actor="system:knowledge" size={22} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-xs text-muted">Checked against what DEMIURGO knows</span>
        {pending ? (
          <span className="inline-flex items-center gap-2 text-[13.5px] text-working-text">
            <Mark kind="working" /> Checking it…
          </span>
        ) : error ? (
          <span className="text-[13.5px] text-problem">The check couldn't run: {error}</span>
        ) : findings.length === 0 ? (
          <span className="text-[13.5px] text-ink-2">It doesn't repeat or contradict anything DEMIURGO knows.</span>
        ) : (
          <ul className="flex flex-col gap-1">
            {findings.map((f) => {
              const verdict = f.finding ?? f.verdict ?? '';
              const cited = f.citation ? citedRecord(f.citation, codes) : null;
              const urgent = verdict === 'conflicts' || verdict === 'duplicates' || verdict === 'inconsistent';
              return (
                <li key={`${verdict}-${f.citation}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px]">
                  <span className={cn('inline-flex items-center gap-1.5 font-semibold', urgent ? 'text-problem' : 'text-ink')}>
                    {urgent && <WarningIcon size={13} />}
                    {FINDING_WORDS[verdict] ?? verdict}
                  </span>
                  {cited ? (
                    <RecordChip projectId={projectId} code={cited.code} version={cited.version} rows={rows} />
                  ) : (
                    <Code>{f.citation}</Code>
                  )}
                  {f.justification && <span className="text-xs text-muted">{f.justification}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The out-of-date box: the clock, the words and why (the server's reason, as it came). */
export function OutOfDate({ title = 'Out of date', children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-dashed border-bar-empty bg-paper px-3.5 py-3" data-out-of-date>
      <span className="flex items-center gap-2 text-sm font-semibold">
        <Mark kind="stale" size={12} />
        {title}
      </span>
      {children && <div className="text-[13.5px] text-ink-2">{children}</div>}
    </div>
  );
}

/** Warnings that a pending proposal may already be out of date (its guard would fail). */
export function MayBeOutOfDate({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-problem-line bg-problem-bg px-3.5 py-3 text-[13.5px] text-problem">
      <span className="flex items-center gap-2 font-semibold">
        <WarningIcon size={14} /> It can't be accepted as it is
      </span>
      <ul className="list-disc pl-6">
        {reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}
