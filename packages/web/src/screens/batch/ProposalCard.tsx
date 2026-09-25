// One proposal at a time (canvas S7B): the design system's Proposal. Who proposes it (the app's
// WhoMark, with its tooltip), where it sits in its batch, what it is, its title and why in the
// author's own words; then what it changes (its payload fields as they came) and what the idea check
// found, and its actions in place. Once resolved, the actions give way to what happened. An
// out-of-date proposal shows the grey clock and why, and nothing to accept.

import { type ItemType, Proposal } from '@demiurgo/design-system';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { Dependency, IdeaAssessmentSummary, ProductRow } from '../../api/types.ts';
import { dayTime } from '../../lib/time.ts';
import { whoOf } from '../../words.ts';
import { Button } from '../../ui/Button.tsx';
import { ArrowRight, type IconKind, RECORD_TYPE } from '../../ui/icons.tsx';
import { MarkWord, StateMark } from '../../ui/marks.tsx';
import { WhoMark } from '../../ui/signals.tsx';
import { CheckCards, ChangeBox, Field, IdeaCheck, MayBeOutOfDate, RecordChip } from './parts.tsx';
import { acceptedRecord, obsoleteReason, proposalTitle, rowOfVersion } from './model.ts';
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

/** What kind of change a proposal is, as the Proposal's type line says it. */
export const PROPOSAL_KIND_WORDS: Record<string, string> = {
  decision: 'New decision',
  fdr: 'New feature',
  exploration: 'New thread',
  review: 'Review',
  imported_record: 'Imported document',
  imported_taxonomy: 'Imported taxonomy',
};

/** The design system's type of a record, from its code (DEC-, ADR-, FDR-, BUG-). */
const CODE_TYPE: Record<string, ItemType> = { DEC: 'decision', ADR: 'tech-decision', FDR: 'feature', BUG: 'bug' };

/** What a proposal is, in the design system's types: what accepting it makes, or the record a review is about. */
export function proposalType(p: Pick<ProposalView, 'type' | 'payload'>): ItemType {
  if (p.type === 'decision') return 'decision';
  if (p.type === 'fdr') return 'feature';
  if (p.type === 'exploration') return 'thread';
  if (p.type === 'design_record') return p.payload.record_type === 'adr' ? 'tech-decision' : 'decision';
  if (p.type === 'review') {
    const r = p.payload.record as { code?: string } | undefined;
    return CODE_TYPE[r?.code?.slice(0, 3) ?? ''] ?? 'decision';
  }
  if (p.type === 'imported_record') {
    const doc = p.payload.document as { type?: string } | undefined;
    return RECORD_TYPE[doc?.type ?? ''] ?? 'feature';
  }
  return 'idea';
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The one line under the title: the proposal's main text. */
export function proposalLine(p: Pick<ProposalView, 'type' | 'payload'>): string {
  if (p.type === 'decision') return str(p.payload.decision);
  if (p.type === 'fdr') return str(p.payload.goal);
  if (p.type === 'review') return str(p.payload.reason);
  if (p.type === 'design_record') return firstSection(p.payload);
  return '';
}

const firstSection = (payload: Record<string, unknown>): string =>
  Array.isArray(payload.sections) ? str((payload.sections[0] as { content?: unknown } | undefined)?.content) : '';

/** Why, in the author's own words: the context of a decision, the goal of a feature, the reason of a review. */
export function proposalWhy(p: Pick<ProposalView, 'type' | 'payload'>): string {
  if (p.type === 'decision') return str(p.payload.context);
  if (p.type === 'fdr') return str(p.payload.goal);
  if (p.type === 'review') return str(p.payload.reason);
  return '';
}

/** What a proposal changes: its payload fields as they are (the title and the why are above them). */
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
        <Field label="Decision">{str(p.payload.decision)}</Field>
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
          <Field label="Scope">{str(p.payload.scope)}</Field>
          <Field label="Out of scope" mark={false}>
            {str(p.payload.out_of_scope)}
          </Field>
          <Field label="Behavior" mark={false}>
            {str(p.payload.behavior)}
          </Field>
          {based?.code && (
            <div className="dm-text-small flex items-center gap-2 pl-[22px] text-muted">
              Based on <RecordChip projectId={projectId} code={based.code} version={based.version ?? null} rows={rows} />
            </div>
          )}
        </ChangeBox>
        {criteria.length > 0 && <CheckCards checks={criteria} />}
      </div>
    );
  }
  if (p.type === 'design_record') {
    const sections = Array.isArray(p.payload.sections) ? (p.payload.sections as { title: string; content: string }[]) : [];
    const criteria = Array.isArray(p.payload.criteria) ? (p.payload.criteria as Parameters<typeof CheckCards>[0]['checks']) : [];
    return (
      <div className="flex flex-col gap-3">
        <ChangeBox>
          {sections.map((s, i) => (
            <Field key={s.title} label={s.title} mark={i === 0}>
              {s.content}
            </Field>
          ))}
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
        <div className="dm-text-small flex flex-wrap items-center gap-2">
          <span className="text-muted">Review</span>
          {r?.code && <RecordChip projectId={projectId} code={r.code} version={r.version ?? null} rows={rows} />}
          <span className="text-muted">· {Math.round(Number(p.payload.confidence ?? 0) * 100)}% sure</span>
        </div>
        {change && (
          <div className="dm-text-small flex flex-wrap items-center gap-2">
            <span className="text-muted">Because of</span>
            <RecordChip projectId={projectId} code={change.code} version={c?.version ?? null} rows={rows} />
          </div>
        )}
        <p className="dm-text-caption text-muted">
          Accepting opens a thread to review it; the record itself doesn&apos;t change.
        </p>
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
  const who = whoOf(producer);
  const obsolete = obsoleteReason(p);
  const outOfDate =
    obsolete !== null || p.state === 'superseded'
      ? `${obsolete ?? 'What it was based on changed.'} It can't be accepted any more. Nothing is lost: it stays here as it came.`
      : undefined;
  const warnings = p.state === 'pending' ? (p.obsolescence ?? []) : [];

  // The actions the tables allow while it is pending; once resolved, what happened; out of date,
  // none (null: the Proposal then draws no Accept, Change and Reject of its own).
  const actions =
    p.state === 'pending' ? (
      <ProposalActions
        projectId={projectId}
        proposal={p}
        blocked={warnings.length > 0}
        {...(p.type === 'review' ? { labels: { accept: 'Open a review', reject: 'Keep it as it is' } } : {})}
        {...(onResolved ? { onResolved } : {})}
      />
    ) : outOfDate ? (
      footer ? (
        <div className="flex justify-end">{footer}</div>
      ) : null
    ) : (
      <Resolved projectId={projectId} proposal={p} footer={footer} />
    );

  return (
    <article
      aria-label={`Proposal ${position} of ${count}: ${title}`}
      data-proposal={p.id}
      data-state={p.state}
      className={className}
    >
      <div data-out-of-date={outOfDate ? 'true' : undefined}>
        <Proposal
          width="100%"
          author={who.kind === 'agent' ? 'agent' : 'demiurgo'}
          authorName={who.kind === 'agent' ? who.name : who.kind === 'automatic' ? "DEMIURGO's knowledge" : undefined}
          whoMark={<WhoMark actor={producer} size={20} />}
          position={`${position} of ${count}${createdAt ? ` · ${dayTime(createdAt)}` : ''}`}
          type={proposalType(p)}
          kindLabel={PROPOSAL_KIND_WORDS[p.type] ?? p.type}
          title={title}
          why={proposalWhy(p)}
          outOfDate={outOfDate}
          mark={
            outOfDate ? (
              <MarkWord kind="stale" word="Out of date" />
            ) : (
              <StateMark entity="proposal" state={p.state} className="tracking-normal" />
            )
          }
          actions={actions}
        >
          <ProposalBody projectId={projectId} proposal={p} rows={rows} />
          {p.dependencies.length > 0 && (
            <div className="dm-text-small flex flex-wrap items-center gap-2 text-muted">
              Starts from
              {p.dependencies.map((d) =>
                d.code ? (
                  <RecordChip key={`${d.id}-${d.version}`} projectId={projectId} code={d.code} version={d.version} rows={rows} />
                ) : null,
              )}
            </div>
          )}
          {p.type !== 'review' && <IdeaCheck projectId={projectId} assessment={p.assessment} rows={rows} />}
          <MayBeOutOfDate reasons={warnings} />
        </Proposal>
      </div>
    </article>
  );
}

/** A resolved proposal: its state, what happened, the reason and the record it made. */
function Resolved({ projectId, proposal: p, footer }: { projectId: string; proposal: ProposalView; footer?: ReactNode }) {
  const effect = acceptedRecord(p);
  return (
    <div className="dm-text-body flex flex-wrap items-center gap-3 border-t border-line-soft pt-3">
      <span className="font-semibold">{resolvedText(p.state, effect)}</span>
      {typeof p.resolution?.reason === 'string' && p.resolution.reason && (
        <span className="dm-text-small text-muted">Reason: {p.resolution.reason}</span>
      )}
      {effect && (
        <Link
          to="/p/$projectId/records/$code"
          params={{ projectId, code: effect.code }}
          search={{ v: effect.version }}
          className="dm-text-small inline-flex items-center gap-1 font-semibold text-needs-strong hover:underline"
        >
          Open {effect.code} <ArrowRight size={12} />
        </Link>
      )}
      <span className="flex-1" />
      {footer}
    </div>
  );
}

/** What happened to a resolved proposal, in one sentence (the state word is in its type line). */
export function resolvedText(state: string, effect: { code: string; approved: boolean } | null): string {
  const made = effect ? (effect.approved ? ` ${effect.code} is approved and current.` : ` ${effect.code} is a draft.`) : '';
  if (state === 'accepted') return `You accepted it.${made}`;
  if (state === 'accepted_edited') return `You accepted your version.${made}`;
  if (state === 'rejected') return 'You rejected it.';
  return '';
}

export function NextButton({ onClick, children = 'Next' }: { onClick: () => void; children?: ReactNode }) {
  return (
    <Button variant="secondary" onClick={onClick}>
      {children}
    </Button>
  );
}
