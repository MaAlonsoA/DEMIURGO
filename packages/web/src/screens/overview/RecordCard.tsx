// A record on the overview: features as the design system's FeatureCard (the six zones of the
// template), decisions and tech decisions as its Node. The marks inside are the app's, with their
// tooltip and their place in the legend. Pointing shows the detail beside it, a click keeps it (the
// card is then selected), Enter opens the page.

import { type Certainty, FeatureCard as DsFeatureCard, Node as DsNode, Signal } from '@demiurgo/design-system';
import { Link, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { ProductRow } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { ago, dayTime } from '../../lib/time.ts';
import { buttonClass } from '../../ui/Button.tsx';
import { Detail } from '../../ui/Card.tsx';
import { ChevronRight, RECORD_ICON, RECORD_TYPE, TypeIcon, WarningIcon } from '../../ui/icons.tsx';
import { useLegendMark } from '../../ui/legend-store.ts';
import { Mark, MarkWord, WorkingMark } from '../../ui/marks.tsx';
import { Peek } from '../../ui/Peek.tsx';
import { ReadinessBox } from '../../ui/Reasons.tsx';
import { NeedsGlyph, NeedsBubble, STAGE_WORDS, StageBars, WhoMark, whoLabel } from '../../ui/signals.tsx';
import { Tip } from '../../ui/Tip.tsx';
import { EPISTEMIC_MARK, MARKS, TYPE_WORDS, whoOf } from '../../words.ts';
import { rowStage, type Waiting, waitingCount, waitingPhrase } from '../record/logic.ts';
import { runDuration } from '../run/runs.ts';
import type { FeatureStatus } from './progress.ts';

/** A dimmed element gets its full contrast back while it is pointed at or focused. */
export const UNDIM = 'hover:[&_[data-card]]:opacity-100 focus-within:[&_[data-card]]:opacity-100';

export type LensMark = { dimmed: boolean; changed: boolean; note: string | null; since: string | null };

type Props = {
  projectId: string;
  row: ProductRow;
  waiting: Waiting;
  /** Purpose of the thread it comes from, if any. */
  thread: string | null;
  lens: LensMark;
};

const certaintyOf = (row: ProductRow): Certainty => (EPISTEMIC_MARK[row.epistemic_status] ?? 'unknown') as Certainty;

function Status({ row, compact = false }: { row: ProductRow; compact?: boolean }) {
  const kind = EPISTEMIC_MARK[row.epistemic_status] ?? 'unknown';
  return (
    <span data-status className="inline-flex tracking-normal">
      {compact ? <Mark kind={kind} /> : <MarkWord kind={kind} word={MARKS[kind].name} />}
    </span>
  );
}

/** The version whose readiness the product shows: the current one, or the latest without one. */
const shownVersion = (row: ProductRow) => row.current ?? row.latest.n;
const verbOf = (row: ProductRow) => (row.latest.state === 'approved' ? 'Approved' : 'Drafted');

function Bars({ row }: { row: ProductRow }) {
  if (row.type !== 'fdr') return null;
  const stage = rowStage(row);
  const reasons = row.readiness?.reasons.length ?? 0;
  const blocks = `${reasons} ${reasons === 1 ? 'thing blocks' : 'things block'} it.`;
  const detail =
    stage === 'ready' ? STAGE_WORDS.ready.phrase : stage === 'doubt' ? `It was ready; now ${blocks}` : `${blocks} Not built.`;
  return <StageBars stage={stage} detail={detail} />;
}

/** The card's signals: only what is not zero, at most four (a newer draft, its checks, DEMIURGO at work). */
function Signals({ row, status, now }: { row: ProductRow; status: FeatureStatus; now: number }) {
  const newer = row.current !== null && row.latest.n > row.current;
  return (
    <>
      {newer && (
        <Tip text={`Version ${row.latest.n} is a draft; version ${row.current} is the current one.`}>
          <span className="inline-flex">
            <Signal kind="changed" value={`v${row.latest.n}`} />
          </span>
        </Tip>
      )}
      {row.checks > 0 && (
        <Tip text={`${row.checks} ${row.checks === 1 ? 'check' : 'checks'}. None has run: nothing is built yet.`}>
          <span className="inline-flex tabular-nums">
            <Signal kind="checks" value={row.checks} />
          </span>
        </Tip>
      )}
      {status?.kind === 'working' && (
        <span data-feature-working className="inline-flex">
          <WorkingMark>{runDuration(status.run, now)}</WorkingMark>
        </span>
      )}
    </>
  );
}

function RecordPeek({ projectId, row, waiting, thread }: Omit<Props, 'lens'>) {
  const readiness = row.readiness;
  const needs = waitingCount(waiting);
  const who = whoOf(row.updated_by);
  return (
    <Detail
      floating
      icon={RECORD_ICON[row.type] ?? 'feature'}
      type={TYPE_WORDS[row.type]}
      status={<Status row={row} />}
      bars={<Bars row={row} />}
      code={`${row.code} · v${shownVersion(row)}`}
      title={row.title}
      line={row.summary}
      who={
        <>
          <WhoMark actor={row.updated_by} size={18} />
          <span>
            {verbOf(row)} by {who.kind === 'you' ? 'you' : whoLabel(who)} · {dayTime(row.updated_at)}
          </span>
        </>
      }
      actions={
        <Link to="/p/$projectId/records/$code" params={{ projectId, code: row.code }} className={buttonClass('secondary')}>
          Open
          <ChevronRight size={12} />
        </Link>
      }
    >
      {needs > 0 && (
        <p className="dm-text-small flex items-center gap-2 rounded-sm border border-needs-line bg-needs-soft px-3 py-2 text-ink">
          <NeedsGlyph count={needs} />
          {waitingPhrase(waiting).replace(/^Needs you: /, '')}
        </p>
      )}
      {readiness && row.type === 'fdr' && (
        <div className="flex flex-col gap-1.5">
          <ReadinessBox reasons={readiness.reasons} warnings={[]} next="Nothing blocks it. Nothing is built yet." />
          {readiness.warnings.length > 0 && (
            <p className="dm-text-caption flex items-center gap-1.5 text-problem">
              <WarningIcon size={13} className="shrink-0" />
              {readiness.warnings.length} {readiness.warnings.length === 1 ? 'warning' : 'warnings'} on how its checks can be
              verified
            </p>
          )}
        </div>
      )}
      <dl className="dm-text-small grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-line-soft pt-3">
        <div className="flex flex-col gap-0.5">
          <dt className="dm-text-caption font-semibold text-muted">Versions</dt>
          <dd>
            {row.current !== null ? `v${row.current} current` : 'None approved yet'}
            {row.latest.n !== row.current && <span className="text-ink-3"> · v{row.latest.n} draft</span>}
          </dd>
        </div>
        {row.type !== 'decision' && (
          <div className="flex flex-col gap-0.5">
            <dt className="dm-text-caption font-semibold text-muted">Checks</dt>
            <dd>{row.checks === 0 ? 'None yet' : row.checks}</dd>
          </div>
        )}
        {thread && (
          <div className="col-span-2 flex flex-col gap-0.5">
            <dt className="dm-text-caption font-semibold text-muted">Comes from</dt>
            <dd className="flex items-center gap-1.5">
              <TypeIcon kind="thread" size={13} className="shrink-0 text-muted" />
              <span className="truncate">{thread}</span>
            </dd>
          </div>
        )}
      </dl>
    </Detail>
  );
}

function Peeking({ projectId, row, children, ...rest }: Omit<Props, 'lens'> & { children: (kept: boolean) => ReactNode }) {
  const navigate = useNavigate();
  return (
    <Peek
      className="h-full"
      label={`${TYPE_WORDS[row.type]}: ${row.title}`}
      onOpen={() => void navigate({ to: '/p/$projectId/records/$code', params: { projectId, code: row.code } })}
      content={<RecordPeek projectId={projectId} row={row} {...rest} />}
    >
      {children}
    </Peek>
  );
}

/** The card as the lens sees it: data-card carries what changed; what didn't is dimmed. */
export function LensFrame({ lens, children }: { lens: LensMark; children: ReactNode }) {
  return (
    <div
      data-card
      data-changed={lens.changed ? 'true' : undefined}
      className={cn('h-full transition-opacity', lens.dimmed && 'opacity-40', lens.changed && '[&>.dm-card]:border-ink-3')}
    >
      {children}
    </div>
  );
}

export function FeatureCard({ status, now, ...p }: Props & { status: FeatureStatus; now: number }) {
  const { row, lens, waiting } = p;
  const needs = waitingCount(waiting);
  useLegendMark(needs > 0 ? 'needs' : null);
  const since = lens.changed && lens.note ? `Since ${lens.since ?? 'your last visit'}: ${lens.note}` : null;
  return (
    <div data-record={row.code} data-dimmed={lens.dimmed ? 'true' : undefined} className={cn('min-w-0', lens.dimmed && UNDIM)}>
      <Peeking {...p}>
        {(kept) => (
          <LensFrame lens={lens}>
            <DsFeatureCard
              width="100%"
              type={RECORD_TYPE[row.type] ?? 'feature'}
              state={certaintyOf(row)}
              mark={<Status row={row} />}
              bars={<Bars row={row} />}
              needs={needs}
              title={row.title}
              line={since ? <span className="font-semibold text-ink">{since}</span> : row.summary}
              who={whoOf(row.updated_by).kind}
              whoMark={<WhoMark actor={row.updated_by} size={18} />}
              when={`${verbOf(row).toLowerCase()} ${ago(row.updated_at)}`}
              signals={<Signals row={row} status={status} now={now} />}
              selected={kept}
            />
          </LensFrame>
        )}
      </Peeking>
    </div>
  );
}

export function RecordNode(p: Props) {
  const { row, lens, waiting } = p;
  return (
    <div data-record={row.code} data-dimmed={lens.dimmed ? 'true' : undefined} className={cn('min-w-0', lens.dimmed && UNDIM)}>
      <Peeking {...p}>
        {(kept) => (
          <LensFrame lens={lens}>
            <DsNode
              type={RECORD_TYPE[row.type] ?? 'decision'}
              state={certaintyOf(row)}
              mark={<Status row={row} compact />}
              title={row.title}
              trailing={<NeedsBubble count={waitingCount(waiting)} detail={waitingPhrase(waiting)} />}
              selected={kept}
            />
          </LensFrame>
        )}
      </Peeking>
    </div>
  );
}
