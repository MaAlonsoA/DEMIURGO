// A record on the overview: features as cards (the six zones of the template), decisions and tech
// decisions as nodes. Pointing shows the detail beside it, a click keeps it, Enter opens the page.

import { Link, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { ProductRow } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { ago, dayTime } from '../../lib/time.ts';
import { buttonStyles } from '../../ui/Button.tsx';
import { Card, Detail, Node } from '../../ui/Card.tsx';
import { ChevronRight, RECORD_ICON, TypeIcon, WarningIcon } from '../../ui/icons.tsx';
import { Mark, MarkWord } from '../../ui/marks.tsx';
import { Peek } from '../../ui/Peek.tsx';
import { ReadinessReasons } from '../../ui/Reasons.tsx';
import { NeedsGlyph, STAGE_WORDS, StageBars, WhoMark, whoLabel } from '../../ui/signals.tsx';
import { Tip } from '../../ui/Tip.tsx';
import { EPISTEMIC_MARK, MARKS, PRODUCT_WORDS, TYPE_WORDS, whoOf } from '../../words.ts';
import { rowStage, type Waiting, waitingCount, waitingPhrase } from '../record/logic.ts';
import { FeaturePill } from './Blueprint.tsx';
import type { FeatureStatus } from './progress.ts';

/** A dimmed element gets its full contrast back while it is pointed at or focused. */
export const UNDIM = 'hover:[&_[data-card]]:opacity-100 focus-within:[&_[data-card]]:opacity-100';

/** The card whose peek is kept open is the selected one: blue outline (canvas S3B). */
const SELECTED =
  '[&_[data-kept]>[data-card]]:border-needs [&_[data-kept]>[data-card]]:shadow-[0_0_0_3px_var(--color-needs-ring)] [&_[data-kept]>[data-card]]:opacity-100';

export type LensMark = { dimmed: boolean; changed: boolean; note: string | null; since: string | null };

type Props = {
  projectId: string;
  row: ProductRow;
  waiting: Waiting;
  /** Purpose of the thread it comes from, if any. */
  thread: string | null;
  lens: LensMark;
};

function Status({ row, compact = false }: { row: ProductRow; compact?: boolean }) {
  const kind = EPISTEMIC_MARK[row.epistemic_status] ?? 'unknown';
  return (
    <span data-status className="inline-flex">
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

function Signals({ row }: { row: ProductRow }) {
  const newer = row.current !== null && row.latest.n > row.current;
  return (
    <>
      {newer && (
        <Tip text={`Version ${row.latest.n} is a draft; version ${row.current} is the current one.`}>
          <span className="font-mono text-[11px] font-medium text-ink-2">v{row.latest.n} draft</span>
        </Tip>
      )}
      {row.checks > 0 && (
        <Tip text={`${row.checks} ${row.checks === 1 ? 'check' : 'checks'}. None has run: nothing is built yet.`}>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <TypeIcon kind="check" size={13} />
            {row.checks}
          </span>
        </Tip>
      )}
      <span className="font-normal text-muted">{PRODUCT_WORDS.notBuilt}</span>
    </>
  );
}

function LensNote({ lens }: { lens: LensMark }) {
  if (!lens.changed || !lens.note) return null;
  return (
    <span className="mt-0.5 text-xs font-semibold text-ink">
      <span className="font-medium text-muted">Since {lens.since ?? 'your last visit'}:</span> {lens.note}
    </span>
  );
}

function RecordPeek({ projectId, row, waiting, thread }: Omit<Props, 'lens'>) {
  const readiness = row.readiness;
  const needs = waitingCount(waiting);
  const who = whoOf(row.updated_by);
  return (
    <Detail
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
        <Link
          to="/p/$projectId/records/$code"
          params={{ projectId, code: row.code }}
          className={buttonStyles({ variant: 'ink', size: 'sm' })}
        >
          Open
          <ChevronRight size={12} />
        </Link>
      }
    >
      {needs > 0 && (
        <p className="flex items-center gap-2 rounded-[var(--radius-control)] bg-needs-bg px-3 py-2 text-[13px] text-ink">
          <NeedsGlyph count={needs} size="sm" />
          {waitingPhrase(waiting).replace(/^Needs you: /, '')}
        </p>
      )}
      {readiness && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
            {readiness.ready ? PRODUCT_WORDS.readyToBuild : 'Before it can be built'}
          </span>
          {readiness.ready ? (
            <p className="text-[13px] text-ink-2">Nothing blocks it. Nothing is built yet.</p>
          ) : (
            <ReadinessReasons reasons={readiness.reasons} warnings={[]} />
          )}
          {readiness.warnings.length > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-problem">
              <WarningIcon size={13} className="shrink-0" />
              {readiness.warnings.length} {readiness.warnings.length === 1 ? 'warning' : 'warnings'} on how its checks can be
              verified
            </p>
          )}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-line-soft pt-3 text-[13px]">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs font-semibold text-muted">Versions</dt>
          <dd>
            {row.current !== null ? `v${row.current} current` : 'None approved yet'}
            {row.latest.n !== row.current && <span className="text-ink-3"> · v{row.latest.n} draft</span>}
          </dd>
        </div>
        {row.type !== 'decision' && (
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs font-semibold text-muted">Checks</dt>
            <dd>{row.checks === 0 ? 'None yet' : row.checks}</dd>
          </div>
        )}
        {thread && (
          <div className="col-span-2 flex flex-col gap-0.5">
            <dt className="text-xs font-semibold text-muted">Comes from</dt>
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

function Peeking({ projectId, row, children, ...rest }: Omit<Props, 'lens'> & { children: ReactNode }) {
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

export function FeatureCard({ status, now, ...p }: Props & { status: FeatureStatus; now: number }) {
  const { row, lens, waiting } = p;
  const needs = waitingCount(waiting);
  const who = (
    <>
      <WhoMark actor={row.updated_by} size={18} />
      <span className="truncate">
        {verbOf(row)} {ago(row.updated_at)}
      </span>
    </>
  );
  return (
    <div
      data-record={row.code}
      data-dimmed={lens.dimmed ? 'true' : undefined}
      className={cn('min-w-0', SELECTED, lens.dimmed && UNDIM)}
    >
      <Peeking {...p}>
        <Card
          icon={RECORD_ICON[row.type] ?? 'feature'}
          type={TYPE_WORDS[row.type]}
          status={<Status row={row} />}
          bars={<Bars row={row} />}
          needs={needs}
          needsDetail={waitingPhrase(waiting)}
          pill={status ? <FeaturePill status={status} now={now} /> : undefined}
          title={row.title}
          line={row.summary}
          who={who}
          signals={<Signals row={row} />}
          dimmed={lens.dimmed}
          changed={lens.changed}
          className={cn('h-full min-h-[150px]', lens.changed && 'border-ink-3')}
        >
          <LensNote lens={lens} />
        </Card>
      </Peeking>
    </div>
  );
}

export function RecordNode(p: Props) {
  const { row, lens, waiting } = p;
  return (
    <div
      data-record={row.code}
      data-dimmed={lens.dimmed ? 'true' : undefined}
      className={cn('min-w-0', SELECTED, lens.dimmed && UNDIM)}
    >
      <Peeking {...p}>
        <Node
          icon={RECORD_ICON[row.type] ?? 'decision'}
          type={TYPE_WORDS[row.type]}
          title={row.title}
          {...(lens.changed && lens.note ? { line: `Since ${lens.since ?? 'your last visit'}: ${lens.note}` } : {})}
          code={`${row.code} · v${shownVersion(row)}`}
          status={<Status row={row} compact />}
          needs={waitingCount(waiting)}
          needsDetail={waitingPhrase(waiting)}
          dimmed={lens.dimmed}
          changed={lens.changed}
          className={cn('h-full', lens.changed && 'border-ink-3')}
        />
      </Peeking>
    </div>
  );
}
