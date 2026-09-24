// A conflict (canvas S6B): knowledge found that an approved change may contradict a record. The two
// things side by side, and DEMIURGO's recommendation in words; it never chooses. "Open a review"
// accepts the review (a thread to review the record); "Keep it as it is" rejects it.

import { useQuery } from '@tanstack/react-query';
import { recordQuery } from '../../api/queries.ts';
import type { RecordVersion } from '../../api/types.ts';
import { dayTime } from '../../lib/time.ts';
import { TYPE_WORDS } from '../../words.ts';
import { Code } from '../../ui/Card.tsx';
import { RECORD_ICON, TypeIcon } from '../../ui/icons.tsx';
import { Skeleton } from '../../ui/layout.tsx';
import { Markdown } from '../../ui/Markdown.tsx';
import { EpistemicMark } from '../../ui/marks.tsx';
import { WhoMark } from '../../ui/signals.tsx';
import { rowOf, rowOfVersion } from '../batch/model.ts';
import { ProposalActions } from '../batch/ProposalActions.tsx';
import { Frame, type Mode, type NeedContext } from './frame.tsx';
import type { NeedItem } from './order.ts';

const RECOMMEND: Record<string, string> = {
  update: 'may need an update',
  invalidate: 'may no longer hold',
  add: 'may need something added',
  other: 'may be affected',
};

type Review = {
  record?: { code?: string; version?: number };
  change?: { id?: string; version?: number | null };
  verdict?: string;
  reason?: string;
};

export function Conflict({
  item,
  ctx,
  mode,
  title,
}: {
  item: Extract<NeedItem, { kind: 'conflict' }>;
  ctx: NeedContext;
  mode: Mode;
  title: string;
}) {
  const review = item.proposal.payload as Review;
  const code = review.record?.code ?? '';
  const record = rowOf(ctx.rows, code);
  const change = review.change?.id ? rowOfVersion(ctx.rows, review.change.id) : undefined;
  const changeName = change ? `“${change.title}”` : 'a newer change';
  const recommendation = `DEMIURGO recommends reviewing ${record ? `“${record.title}”` : code}: with ${changeName} approved, it ${
    RECOMMEND[review.verdict ?? ''] ?? 'may be affected'
  }. It won't choose for you: nothing changes until you do.`;
  return (
    <Frame
      mode={mode}
      item={item}
      ctx={ctx}
      eyebrow={<span className="text-muted">{item.approved ? 'with something you approved' : 'with an earlier version'}</span>}
      title={title}
      code={code ? `${code} v${review.record?.version ?? ''}` : undefined}
      line={
        mode === 'row' ? (
          <span>
            Because of {changeName}
            {change && (
              <Code className="ml-1">{`${change.code}${review.change?.version ? ` v${review.change.version}` : ''}`}</Code>
            )}
            . {review.reason}
          </span>
        ) : (
          'Both sides are in DEMIURGO. It shows them together and recommends; you decide.'
        )
      }
    >
      {mode === 'focus' && (
        <div className="mb-3.5 flex flex-col gap-3.5">
          <div className="grid grid-cols-[minmax(0,1fr)_36px_minmax(0,1fr)] items-stretch gap-2">
            <Side projectId={ctx.projectId} label="To review" code={code} version={review.record?.version ?? null} />
            <span
              role="img"
              aria-label="may contradict"
              className="inline-flex h-8 w-8 items-center justify-center self-center rounded-full bg-problem-bg text-[17px] font-bold text-problem"
            >
              ≠
            </span>
            {change ? (
              <Side projectId={ctx.projectId} label="The change" code={change.code} version={review.change?.version ?? null} />
            ) : (
              <div className="rounded-xl border border-dashed border-line-strong px-3.5 py-3 text-[13px] text-muted">
                The change that triggered it is no longer in the product&apos;s current view.
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1 rounded-[10px] bg-surface-2 px-3.5 py-2.5">
            <span className="text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">What DEMIURGO recommends</span>
            <p className="text-[13.5px]">{recommendation}</p>
            {review.reason && (
              <p className="text-xs text-muted">
                Why: {review.reason} ({Math.round(Number(item.proposal.payload.confidence ?? 0) * 100)}% sure)
              </p>
            )}
          </div>
        </div>
      )}
      {mode === 'row' && <p className="mb-2 text-[13px] text-ink-2">{recommendation}</p>}
      <ProposalActions
        projectId={ctx.projectId}
        proposal={item.proposal}
        blocked={item.proposal.obsolescence.length > 0}
        size={mode === 'focus' ? 'lg' : 'md'}
        labels={{ accept: 'Open a review', reject: 'Keep it as it is' }}
      />
    </Frame>
  );
}

/** One side of the conflict: the record, the version in question, its text and who approved it. */
function Side({ projectId, label, code, version }: { projectId: string; label: string; code: string; version: number | null }) {
  const detail = useQuery(recordQuery(projectId, code)).data;
  const v: RecordVersion | undefined = detail?.versions.find((x) => x.n === version) ?? detail?.versions.at(-1);
  if (!detail || !v) {
    return (
      <div className="flex h-[140px] flex-col gap-2 rounded-xl border border-line bg-surface px-3.5 py-3" aria-hidden="true">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  const text = v.sections.find((s) => s.title === 'Decision')?.content ?? v.sections.find((s) => s.content.trim())?.content ?? '';
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-3">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
        <TypeIcon kind={RECORD_ICON[detail.type] ?? 'decision'} size={12} />
        {label} · {TYPE_WORDS[detail.type]}
        <EpistemicMark status={v.epistemic_status} />
      </span>
      <strong className="text-[14px] font-semibold">
        {v.title} <Code className="whitespace-nowrap">{`${detail.code} v${v.n}`}</Code>
      </strong>
      <Markdown className="line-clamp-4 text-[13.5px]">{text}</Markdown>
      <span className="mt-auto flex items-center gap-1.5 text-xs text-muted">
        <WhoMark actor={v.approved_by ?? v.author} size={16} />
        {v.approved_by ? `Approved ${dayTime(v.approved_at)}` : `Drafted ${dayTime(v.created_at)}`}
      </span>
    </div>
  );
}
