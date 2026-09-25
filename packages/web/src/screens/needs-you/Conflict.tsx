// A conflict (DESIGN.md §3.1): knowledge found that an approved change may contradict a record. The
// two sides next to each other, and DEMIURGO's recommendation in words; it never chooses. "Open a
// review" accepts the review (a thread to review the record); "Keep it as it is" rejects it
// (INV-NEED-12, INV-CATCH-05).

import { useQuery } from '@tanstack/react-query';
import { recordQuery } from '../../api/queries.ts';
import type { RecordVersion } from '../../api/types.ts';
import { Code } from '../../components/Badge.tsx';
import { Card } from '../../components/Card.tsx';
import { AlertTriangleIcon } from '../../components/icons.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { Bone } from '../../components/Spinner.tsx';
import { Certainty, StatusBadge } from '../../components/status.tsx';
import { DayTime } from '../../components/Time.tsx';
import { TypeIcon, typeWord } from '../../components/types.tsx';
import { WhoAvatar } from '../../components/Who.tsx';
import { whoOf } from '../../words.ts';
import { rowOf, rowOfVersion } from '../batch/model.ts';
import { BlockedNotice } from '../batch/parts.tsx';
import { ProposalDecision } from '../batch/ProposalActions.tsx';
import type { DetailProps } from './Detail.tsx';
import { DetailFrame } from './frame.tsx';
import { VERDICT_WORDS } from './titles.ts';

type Review = {
  record?: { code?: string; version?: number };
  change?: { id?: string; version?: number | null };
  verdict?: string;
  reason?: string;
  confidence?: number;
};

export function Conflict({ item, ctx, titleId, top, title }: DetailProps<'conflict'> & { title: string }) {
  const review = item.proposal.payload as Review;
  const code = review.record?.code ?? '';
  const record = rowOf(ctx.rows, code);
  const change = review.change?.id ? rowOfVersion(ctx.rows, review.change.id) : undefined;
  const changeName = change ? `“${change.title}”` : 'a newer change';
  const verdict = VERDICT_WORDS[review.verdict ?? ''] ?? 'may be affected';
  const recommendation = `DEMIURGO recommends reviewing ${record ? `“${record.title}”` : code}: with ${changeName} approved, it ${verdict}. It won't choose for you: nothing changes until you do.`;
  const sure = Math.round((review.confidence ?? 0) * 100);
  const warnings = item.proposal.obsolescence;
  return (
    <DetailFrame
      item={item}
      ctx={ctx}
      titleId={titleId}
      top={top}
      title={title}
      code={code ? `${code} v${review.record?.version ?? ''}` : undefined}
      state={<StatusBadge kind="conflict" word={item.approved ? 'With something you approved' : 'With an earlier version'} />}
      why={
        <>
          <span>Because of {changeName}</span>
          {change ? <Code>{`${change.code}${review.change?.version ? ` v${review.change.version}` : ''}`}</Code> : null}
          {review.reason ? <span>· {review.reason}</span> : null}
        </>
      }
      decision={
        <>
          <BlockedNotice reasons={warnings} />
          <ProposalDecision
            projectId={ctx.projectId}
            proposal={item.proposal}
            blocked={warnings}
            labels={{ accept: 'Open a review', reject: 'Keep it as it is' }}
            // The page says the result, with what is left in Needs you.
            onDone={() => {}}
          />
        </>
      }
    >
      <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)]">
        <Side projectId={ctx.projectId} label="To review" code={code} version={review.record?.version ?? null} />
        <span className="flex items-center justify-center" role="img" aria-label="may contradict">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-danger-edge bg-danger-soft text-danger-text">
            <AlertTriangleIcon size={15} />
          </span>
        </span>
        {change ? (
          <Side projectId={ctx.projectId} label="The change" code={change.code} version={review.change?.version ?? null} />
        ) : (
          <div className="rounded-lg border border-dashed border-edge-strong px-3.5 py-3 text-sm text-fg-2">
            <p className="font-medium text-fg">The change</p>
            The change that triggered it is no longer in the product&apos;s current view.
          </div>
        )}
      </div>
      <Card padding="md" className="flex flex-col gap-1.5 bg-sunken" data-recommendation>
        <p className="text-sm font-medium text-fg">What DEMIURGO recommends</p>
        <p className="text-base text-fg">{recommendation}</p>
        {review.reason ? (
          <p className="text-sm text-fg-2">
            Why: {review.reason} ({sure}% sure)
          </p>
        ) : null}
      </Card>
    </DetailFrame>
  );
}

/** One side of the conflict: the record, the version in question, its text and who approved it. */
function Side({ projectId, label, code, version }: { projectId: string; label: string; code: string; version: number | null }) {
  const detail = useQuery({ ...recordQuery(projectId, code), enabled: code !== '' }).data;
  const v: RecordVersion | undefined = detail?.versions.find((x) => x.n === version) ?? detail?.versions.at(-1);
  if (!detail || !v) {
    return (
      <Card padding="md" className="flex min-h-36 flex-col gap-2">
        <p className="text-sm font-medium text-fg-2">{label}</p>
        <Bone className="h-4 w-2/3" />
        <Bone className="h-12 w-full" />
      </Card>
    );
  }
  const text = v.sections.find((s) => s.title === 'Decision')?.content ?? v.sections.find((s) => s.content.trim())?.content ?? '';
  const by = v.approved_by ?? v.author;
  return (
    <Card padding="md" className="flex min-w-0 flex-col gap-2" data-side={label}>
      <p className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
        <span className="font-medium text-fg">{label}</span>
        <span className="inline-flex items-center gap-1">
          <TypeIcon type={detail.type} size={13} className="text-fg-3" />
          {typeWord(detail.type)}
        </span>
        <Certainty status={v.epistemic_status} />
      </p>
      <p className="font-medium text-fg">
        {v.title} <Code className="whitespace-nowrap">{`${detail.code} v${v.n}`}</Code>
      </p>
      <Markdown size="sm" className="line-clamp-4">
        {text}
      </Markdown>
      <p className="mt-auto flex items-center gap-1.5 text-xs text-fg-2">
        <WhoAvatar kind={whoOf(by).kind} size={16} />
        {v.approved_by ? (
          <>
            Approved <DayTime iso={v.approved_at} />
          </>
        ) : (
          <>
            Drafted <DayTime iso={v.created_at} />
          </>
        )}
      </p>
    </Card>
  );
}
