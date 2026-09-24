// One proposal at a time (canvas S7B): what it is and its state, its title, what it changes (its
// payload fields as they came), who proposed it, what the idea check found, and its actions in
// place. An out-of-date proposal shows the clock and why, and nothing to accept.

import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { Dependency, IdeaAssessmentSummary, ProductRow } from '../../api/types.ts';
import { dayTime } from '../../lib/time.ts';
import { cn } from '../../lib/cn.ts';
import { stateWord, whoOf } from '../../words.ts';
import { Button } from '../../ui/Button.tsx';
import { ArrowRight, type IconKind } from '../../ui/icons.tsx';
import { Mark, StateMark } from '../../ui/marks.tsx';
import { WhoMark } from '../../ui/signals.tsx';
import {
  CheckCards,
  ChangeBox,
  Dot,
  Eyebrow,
  EyebrowWord,
  Field,
  IdeaCheck,
  MayBeOutOfDate,
  OutOfDate,
  RecordChip,
  TypeLabel,
} from './parts.tsx';
import { acceptedRecord, obsoleteReason, PROPOSAL_TYPE_WORDS, proposalTitle, rowOfVersion } from './model.ts';
import { ProposalActions } from './ProposalActions.tsx';

export type ProposalView = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  state: string;
  dependencies: Dependency[];
  resolution?: Record<string, unknown> | null;
  resolved_at?: string | null;
  obsolescence?: string[];
  assessment?: IdeaAssessmentSummary | null;
};

export const PROPOSAL_ICON: Record<string, IconKind> = {
  decision: 'decision',
  fdr: 'feature',
  exploration: 'thread',
  review: 'knowledge',
  imported_record: 'package',
  imported_taxonomy: 'taxonomy',
};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The one line under the title: the proposal's main text. */
export function proposalLine(p: Pick<ProposalView, 'type' | 'payload'>): string {
  if (p.type === 'decision') return str(p.payload.decision);
  if (p.type === 'fdr') return str(p.payload.goal);
  if (p.type === 'review') return str(p.payload.reason);
  return '';
}

/** What a proposal changes: its payload fields as they are. */
export function ProposalBody({
  projectId,
  proposal: p,
  rows,
}: {
  projectId: string;
  proposal: ProposalView;
  rows: readonly ProductRow[];
}) {
  const based = p.payload.based_on as { code?: string; version?: number } | undefined;
  if (p.type === 'decision') {
    return (
      <ChangeBox>
        <Field label="New decision">{str(p.payload.title)}</Field>
        <Field label="Context" mark={false}>
          {str(p.payload.context)}
        </Field>
        <Field label="Consequences" mark={false}>
          {str(p.payload.consequences)}
        </Field>
      </ChangeBox>
    );
  }
  if (p.type === 'fdr') {
    const criteria = Array.isArray(p.payload.criteria) ? (p.payload.criteria as Parameters<typeof CheckCards>[0]['checks']) : [];
    return (
      <div className="flex flex-col gap-3">
        <ChangeBox>
          <Field label="New feature">{str(p.payload.title)}</Field>
          <Field label="Scope" mark={false}>
            {str(p.payload.scope)}
          </Field>
          <Field label="Out of scope" mark={false}>
            {str(p.payload.out_of_scope)}
          </Field>
          <Field label="Behavior" mark={false}>
            {str(p.payload.behavior)}
          </Field>
          {based?.code && (
            <div className="flex items-center gap-2 pl-[22px] text-[13px] text-muted">
              Based on <RecordChip projectId={projectId} code={based.code} version={based.version ?? null} rows={rows} />
            </div>
          )}
        </ChangeBox>
        {criteria.length > 0 && <CheckCards checks={criteria} />}
      </div>
    );
  }
  if (p.type === 'exploration') {
    return (
      <ChangeBox>
        <Field label="New thread">{str(p.payload.purpose)}</Field>
      </ChangeBox>
    );
  }
  if (p.type === 'review') {
    const r = p.payload.record as { code?: string; version?: number } | undefined;
    const c = p.payload.change as { id?: string; version?: number | null } | undefined;
    const change = c?.id ? rowOfVersion(rows, c.id) : undefined;
    return (
      <ChangeBox title="What it asks">
        <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
          <span className="text-muted">Review</span>
          {r?.code && <RecordChip projectId={projectId} code={r.code} version={r.version ?? null} rows={rows} />}
          <span className="text-muted">· {Math.round(Number(p.payload.confidence ?? 0) * 100)}% sure</span>
        </div>
        {change && (
          <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
            <span className="text-muted">Because of</span>
            <RecordChip projectId={projectId} code={change.code} version={c?.version ?? null} rows={rows} />
          </div>
        )}
        <p className="text-xs text-muted">Accepting opens a thread to review it; the record itself doesn&apos;t change.</p>
      </ChangeBox>
    );
  }
  return null;
}

export function ProposalCard({
  projectId,
  proposal: p,
  position,
  count,
  producer,
  createdAt,
  rows,
  footer,
  className,
  onResolved,
}: {
  projectId: string;
  proposal: ProposalView;
  position: number;
  count: number;
  producer: string;
  createdAt?: string;
  rows: readonly ProductRow[];
  /** Shown once the proposal is resolved (e.g. "Next"). */
  footer?: ReactNode;
  className?: string;
  onResolved?: () => void;
}) {
  const title = proposalTitle(p);
  const line = proposalLine(p);
  const who = whoOf(producer);
  const obsolete = obsoleteReason(p);
  const warnings = p.state === 'pending' ? (p.obsolescence ?? []) : [];
  const effect = acceptedRecord(p);
  const pending = p.state === 'pending';
  return (
    <article
      aria-label={`Proposal ${position} of ${count}: ${title}`}
      data-proposal={p.id}
      data-state={p.state}
      className={cn('flex flex-col gap-3.5 rounded-2xl border border-line bg-surface px-[22px] py-[18px]', className)}
    >
      <Eyebrow>
        <span>
          {position} of {count}
        </span>
        <Dot />
        <TypeLabel icon={PROPOSAL_ICON[p.type] ?? 'idea'}>{PROPOSAL_TYPE_WORDS[p.type] ?? p.type}</TypeLabel>
        <Dot />
        <EyebrowWord>
          <StateMark entity="proposal" state={p.state} />
        </EyebrowWord>
      </Eyebrow>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[22px] leading-tight font-semibold">{title}</h2>
        {line && <p className="text-[14.5px] text-ink-2">{line}</p>}
      </div>

      <ProposalBody projectId={projectId} proposal={p} rows={rows} />

      {p.dependencies.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          Starts from
          {p.dependencies.map((d) =>
            d.code ? (
              <RecordChip key={`${d.id}-${d.version}`} projectId={projectId} code={d.code} version={d.version} rows={rows} />
            ) : null,
          )}
        </div>
      )}

      <div className="flex items-center gap-2.5 text-[13px] text-ink-2">
        <WhoMark actor={producer} size={22} />
        <span>
          {who.kind === 'demiurgo'
            ? 'Drafted by DEMIURGO'
            : who.kind === 'agent'
              ? `Proposed by ${who.name}`
              : "Found by DEMIURGO's knowledge"}
          {createdAt && <span className="text-muted"> · {dayTime(createdAt)}</span>}
        </span>
      </div>

      {p.type !== 'review' && <IdeaCheck projectId={projectId} assessment={p.assessment} rows={rows} />}

      {obsolete !== null || p.state === 'superseded' ? (
        <OutOfDate>
          {obsolete ?? 'What it was based on changed.'} It can&apos;t be accepted any more. Nothing is lost: it stays here as it
          came.
        </OutOfDate>
      ) : null}
      <MayBeOutOfDate reasons={warnings} />

      {pending ? (
        <ProposalActions
          projectId={projectId}
          proposal={p}
          blocked={warnings.length > 0}
          {...(p.type === 'review' ? { labels: { accept: 'Open a review', reject: 'Keep it as it is' } } : {})}
          className="pt-1"
          {...(onResolved ? { onResolved } : {})}
        />
      ) : p.state !== 'superseded' ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-line-soft pt-3 text-sm">
          <span className="flex items-center gap-2 font-semibold">
            <Mark kind={stateWord('proposal', p.state).mark} />
            {resolvedText(p.state, effect)}
          </span>
          {typeof p.resolution?.reason === 'string' && p.resolution.reason && (
            <span className="text-[13px] text-muted">Reason: {p.resolution.reason}</span>
          )}
          {effect && (
            <Link
              to="/p/$projectId/records/$code"
              params={{ projectId, code: effect.code }}
              search={{ v: effect.version }}
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-needs hover:text-needs-hover"
            >
              Open {effect.code} <ArrowRight size={12} />
            </Link>
          )}
          <span className="flex-1" />
          {footer}
        </div>
      ) : footer ? (
        <div className="flex justify-end">{footer}</div>
      ) : null}
    </article>
  );
}

/** What happened to a resolved proposal, in one sentence (the state word is in the eyebrow). */
export function resolvedText(state: string, effect: { code: string; approved: boolean } | null): string {
  const made = effect ? (effect.approved ? ` ${effect.code} is approved and current.` : ` ${effect.code} is a draft.`) : '';
  if (state === 'accepted') return `You accepted it.${made}`;
  if (state === 'accepted_edited') return `You accepted your version.${made}`;
  if (state === 'rejected') return 'You rejected it.';
  return '';
}

export function NextButton({ onClick, children = 'Next' }: { onClick: () => void; children?: ReactNode }) {
  return (
    <Button size="lg" variant="outline" onClick={onClick}>
      {children}
    </Button>
  );
}
