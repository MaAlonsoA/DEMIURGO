// One proposal, read in full (DESIGN.md §3.1.1), the same in Needs you, Catch up and the batch page:
// who proposes it and where it sits in its batch; what kind of change it is, its state, its title
// and why in the author's words; what it changes, by type (prose for text, rows for checks); the
// evidence — what DEMIURGO knows about it, what it starts from, the run that drafted it — and then
// the decision. Once decided, the decision gives way to what happened; out of date, to why (R22,
// R67, P3 evidence before narration).

import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { ProductRow } from '../../api/types.ts';
import { ArrowRightIcon } from '../../components/icons.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { EntityState, StatusBadge } from '../../components/status.tsx';
import { RelativeTime } from '../../components/Time.tsx';
import { TypeIcon } from '../../components/types.tsx';
import { WhoAvatar, whoName } from '../../components/Who.tsx';
import { cn } from '../../lib/cn.ts';
import { whoOf } from '../../words.ts';
import { acceptedRecord, obsoleteReason, proposalTitle, rowOfVersion } from './model.ts';
import { BlockedNotice, ChecksList, Evidence, IdeaCheck, linkClass, OutOfDate, RecordChip, RunLine, Sections } from './parts.tsx';
import { ProposalDecision } from './ProposalActions.tsx';
import {
  kindWord,
  outOfDateText,
  payloadChecks,
  payloadSections,
  type ProposalView as ProposalData,
  proposalIconType,
  proposalWhy,
  resolvedText,
} from './proposal.ts';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The name of who proposes: an agent by its name, DEMIURGO, or DEMIURGO's knowledge. */
export function producerName(producer: string): string {
  const who = whoOf(producer);
  return who.kind === 'automatic' ? "DEMIURGO's knowledge" : whoName(who);
}

/** A text field of the payload as prose under its heading; nothing when it is empty. */
function Prose({ title, text }: { title: string; text: string }) {
  if (!text.trim()) return null;
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold text-fg-2">{title}</h3>
      <Markdown>{text}</Markdown>
    </section>
  );
}

function Checks({ proposal: p }: { proposal: ProposalData }) {
  const checks = payloadChecks(p.payload);
  if (checks.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-sm font-semibold text-fg-2">Checks ({checks.length})</h3>
        {p.state === 'pending' ? <span className="text-xs text-fg-3">Codes are given when it is accepted</span> : null}
      </div>
      <ChecksList checks={checks} />
    </section>
  );
}

/** What a proposal changes, by its type (INV-PROP-10). The title and the why are above it. */
export function ProposalBody({
  projectId,
  proposal: p,
  rows,
  withGoal = false,
}: {
  projectId: string;
  proposal: ProposalData;
  rows: readonly ProductRow[];
  /** Show a feature's goal here too (the package page has no "why" line). */
  withGoal?: boolean;
}) {
  const based = p.payload.based_on as { code?: string; version?: number } | undefined;
  if (p.type === 'decision') {
    return (
      <div className="flex flex-col gap-4" data-body="decision">
        {withGoal ? <Prose title="Context" text={str(p.payload.context)} /> : null}
        <Prose title="Decision" text={str(p.payload.decision)} />
        <Prose title="Consequences" text={str(p.payload.consequences)} />
      </div>
    );
  }
  if (p.type === 'fdr') {
    return (
      <div className="flex flex-col gap-4" data-body="fdr">
        {withGoal ? <Prose title="Goal" text={str(p.payload.goal)} /> : null}
        <Prose title="Scope" text={str(p.payload.scope)} />
        <Prose title="Out of scope" text={str(p.payload.out_of_scope)} />
        <Prose title="Behavior" text={str(p.payload.behavior)} />
        {based?.code ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
            Based on <RecordChip projectId={projectId} code={based.code} version={based.version ?? null} rows={rows} />
          </p>
        ) : null}
        <Checks proposal={p} />
      </div>
    );
  }
  if (p.type === 'design_record') {
    return (
      <div className="flex flex-col gap-4" data-body="design_record">
        <Sections sections={payloadSections(p.payload)} />
        <Checks proposal={p} />
      </div>
    );
  }
  if (p.type === 'exploration') {
    return (
      <div className="flex flex-col gap-1" data-body="exploration">
        <h3 className="text-sm font-semibold text-fg-2">New thread</h3>
        <p className="text-md text-fg">{str(p.payload.purpose)}</p>
      </div>
    );
  }
  if (p.type === 'review') {
    const r = p.payload.record as { code?: string; version?: number } | undefined;
    const c = p.payload.change as { id?: string; version?: number | null } | undefined;
    const change = c?.id ? rowOfVersion(rows, c.id) : undefined;
    return (
      <div className="flex flex-col gap-2 text-sm" data-body="review">
        <h3 className="font-semibold text-fg-2">What it asks</h3>
        <p className="flex flex-wrap items-center gap-2 text-fg-2">
          Review
          {r?.code ? <RecordChip projectId={projectId} code={r.code} version={r.version ?? null} rows={rows} /> : null}
          <span>· {Math.round(Number(p.payload.confidence ?? 0) * 100)}% sure</span>
        </p>
        {change ? (
          <p className="flex flex-wrap items-center gap-2 text-fg-2">
            Because of
            <RecordChip projectId={projectId} code={change.code} version={c?.version ?? null} rows={rows} />
          </p>
        ) : null}
        <p className="text-fg-2">Accepting opens a thread to review it; the record itself doesn&apos;t change.</p>
      </div>
    );
  }
  return null;
}

export function ProposalView({
  projectId,
  proposal: p,
  position,
  count,
  producer,
  createdAt,
  runId,
  rows,
  titleId,
  meta,
  children,
  footer,
  onDone,
  className,
}: {
  projectId: string;
  proposal: ProposalData;
  position: number;
  count: number;
  producer: string;
  createdAt?: string | undefined;
  /** The run that drafted its batch, when DEMIURGO did. */
  runId?: string | null | undefined;
  rows: readonly ProductRow[];
  /** The id of its title (h2), the focus target after a decision elsewhere. */
  titleId: string;
  /** More on the author line ("Open the batch"). */
  meta?: ReactNode;
  /** Shown after what it changes (e.g. "What it unblocks"). */
  children?: ReactNode;
  /** Shown once it is decided or out of date (e.g. "Next"). */
  footer?: ReactNode;
  onDone?: (said: string) => void;
  className?: string;
}) {
  const title = proposalTitle(p);
  const why = proposalWhy(p);
  const who = whoOf(producer);
  const obsolete = obsoleteReason(p);
  const outOfDate = p.state === 'superseded';
  const warnings = p.state === 'pending' ? (p.obsolescence ?? []) : [];
  const deps = p.dependencies.filter((d) => d.code);

  return (
    <article aria-labelledby={titleId} data-proposal={p.id} data-state={p.state} className={cn('flex flex-col gap-5', className)}>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-2">
          <span className="inline-flex items-center gap-1.5 font-medium text-fg" title={producerName(producer)}>
            <WhoAvatar kind={who.kind} size={18} />
            {producerName(producer)}
          </span>
          <span>proposes</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            {position} of {count}
          </span>
          {createdAt ? (
            <>
              <span aria-hidden>·</span>
              <RelativeTime iso={createdAt} />
            </>
          ) : null}
          {meta}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 font-medium text-fg-2">
            <TypeIcon type={proposalIconType(p)} size={15} className="text-fg-3" />
            {kindWord(p.type)}
          </span>
          {outOfDate ? <StatusBadge kind="stale" word="Out of date" /> : <EntityState entity="proposal" state={p.state} />}
        </div>
        <h2 id={titleId} tabIndex={-1} className="text-xl font-semibold text-fg outline-none">
          {title}
        </h2>
        {why ? <p className="max-w-prose text-md text-fg-2">“{why}”</p> : null}
      </header>

      {outOfDate ? <OutOfDate>{outOfDateText(obsolete)}</OutOfDate> : null}

      <ProposalBody projectId={projectId} proposal={p} rows={rows} />

      {children}

      {deps.length > 0 ? (
        <Evidence title="Starts from">
          <div className="flex flex-wrap gap-2">
            {deps.map((d) => (
              <RecordChip
                key={`${d.id}-${d.version}`}
                projectId={projectId}
                code={d.code ?? ''}
                version={d.version}
                rows={rows}
              />
            ))}
          </div>
        </Evidence>
      ) : null}
      {p.type !== 'review' ? <IdeaCheck projectId={projectId} assessment={p.assessment} rows={rows} /> : null}
      {runId ? (
        <Evidence title="Drafted by DEMIURGO">
          <RunLine projectId={projectId} runId={runId} />
        </Evidence>
      ) : null}

      {/* Direct children of the article, so the decision bar sticks along the whole proposal. */}
      {p.state === 'pending' ? (
        <>
          <BlockedNotice reasons={warnings} />
          <ProposalDecision
            projectId={projectId}
            proposal={p}
            blocked={warnings}
            {...(p.type === 'review' ? { labels: { accept: 'Open a review', reject: 'Keep it as it is' } } : {})}
            {...(onDone ? { onDone } : {})}
          />
        </>
      ) : outOfDate ? (
        footer ? (
          <div className="flex justify-end border-t border-edge pt-3">{footer}</div>
        ) : null
      ) : (
        <Resolved projectId={projectId} proposal={p} footer={footer} />
      )}
    </article>
  );
}

/** A decided proposal: what happened, the reason, and the record it made (INV-PROP-20). */
function Resolved({ projectId, proposal: p, footer }: { projectId: string; proposal: ProposalData; footer?: ReactNode }) {
  const effect = acceptedRecord(p);
  const reason = typeof p.resolution?.reason === 'string' ? p.resolution.reason : '';
  return (
    <div data-resolved className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-edge pt-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-medium text-fg">{resolvedText(p.state, effect)}</p>
        {reason ? <p className="text-sm text-fg-2">Reason: {reason}</p> : null}
        {effect ? (
          <Link
            to="/p/$projectId/records/$code"
            params={{ projectId, code: effect.code }}
            search={{ v: effect.version }}
            className={cn(linkClass, 'inline-flex min-h-6 w-fit items-center gap-1 text-sm')}
          >
            Open {effect.code} <ArrowRightIcon size={13} />
          </Link>
        ) : null}
      </div>
      {footer}
    </div>
  );
}
