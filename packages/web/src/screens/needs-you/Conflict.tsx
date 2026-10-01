// A conflict (DESIGN.md §3.1): knowledge found two records that say different things. The page says,
// in plain words, what conflicts with what (the record to review and the approved change that
// triggered it), the two exact sentences side by side (older first), and what each button does.
// DEMIURGO never chooses: «Update» accepts the review (opens a thread to review the record) and
// «Keep both as they are» rejects it (INV-NEED-12, INV-CATCH-05).

import { useQuery } from '@tanstack/react-query';
import { recordQuery } from '../../api/queries.ts';
import type { RecordDetail, RecordVersion } from '../../api/types.ts';
import { Code } from '../../components/Badge.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { Bone } from '../../components/Spinner.tsx';
import { DayTime } from '../../components/Time.tsx';
import { useMessages } from '../../i18n/define.ts';
import { rowOf } from '../batch/model.ts';
import { BlockedNotice, Disclosure } from '../batch/parts.tsx';
import { ProposalDecision } from '../batch/ProposalActions.tsx';
import { buildFact, type ConflictReview, changeCodeOf, conflictNature, olderFirst, sentencesOf, surenessOf } from './conflict.ts';
import type { DetailProps } from './Detail.tsx';
import { DetailFrame } from './frame.tsx';
import { CONFLICT, TITLES } from './words.i18n.ts';

type Loaded = { code: string; version: number | null; quote: string | null; detail?: RecordDetail | undefined; v?: RecordVersion | undefined };

export function Conflict({ item, ctx, titleId, top }: DetailProps<'conflict'> & { title: string }) {
  const t = useMessages(CONFLICT);
  const titleWords = useMessages(TITLES);
  const review = item.proposal.payload as ConflictReview;
  const code = review.record?.code ?? '';
  const changeCode = changeCodeOf(review, ctx.rows) ?? '';
  const record = rowOf(ctx.rows, code);
  const coherence = !!review.quotes;
  const same = conflictNature(review) === 'same';
  const sentences = sentencesOf(review);
  const sure = surenessOf(review);
  const warnings = item.proposal.obsolescence;
  const recordDetail = useQuery({ ...recordQuery(ctx.projectId, code), enabled: code !== '' }).data;
  const changeDetail = useQuery({ ...recordQuery(ctx.projectId, changeCode), enabled: changeCode !== '' }).data;
  const pick = (detail: RecordDetail | undefined, version: number | null | undefined) =>
    detail?.versions.find((x) => x.n === version) ?? detail?.versions.at(-1);
  const a: Loaded & { when: string | null } = {
    code,
    version: review.record?.version ?? null,
    quote: sentences.a,
    detail: recordDetail,
    v: pick(recordDetail, review.record?.version),
    when: null,
  };
  const b: Loaded & { when: string | null } = {
    code: changeCode,
    version: review.change?.version ?? review.other?.version ?? null,
    quote: sentences.b,
    detail: changeDetail,
    v: pick(changeDetail, review.change?.version ?? review.other?.version),
    when: null,
  };
  for (const s of [a, b]) s.when = s.v ? (s.v.approved_at ?? s.v.created_at) : null;
  const sides = changeCode ? olderFirst(a, b) : [a];
  const title = changeCode
    ? t.headline(changeCode, code, same)
    : `${record?.title ?? code} ${titleWords.verdictWord(String(review.verdict))}`;
  return (
    <DetailFrame
      item={item}
      ctx={ctx}
      titleId={titleId}
      top={top}
      title={title}
      decision={
        <>
          <BlockedNotice reasons={warnings} />
          <ProposalDecision
            projectId={ctx.projectId}
            proposal={item.proposal}
            blocked={warnings}
            labels={{ accept: t.updateLabel(code), reject: t.keepLabel }}
            hints={{
              accept: changeCode ? t.updateHint(code, changeCode) : undefined,
              reject: coherence || !changeCode ? t.keepHintCoherence : t.keepHintChange(code, changeCode),
            }}
            // The page says the result, with what is left in Needs you.
            onDone={() => {}}
          />
        </>
      }
    >
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {sides.map((s) => (
          <Side key={s.code} side={s} />
        ))}
      </div>
      {!changeCode ? <p className="text-sm text-fg-2">{t.changeGone}</p> : null}
      {coherence ? <p className="text-sm text-fg-2">{t.fromCoherence(review.epic ?? '')}</p> : null}
      {sure !== null && changeCode ? <p className="text-base text-fg">{t.sure(sure, same)}</p> : null}
      {review.reason && (coherence || (!sentences.a && !sentences.b)) ? (
        <p className="max-w-prose text-sm text-fg-2">{t.why(review.reason)}</p>
      ) : null}
      <Disclosure label={t.fullRecords}>
        <div className="grid items-start gap-6 lg:grid-cols-2">
          {sides.map((s) => (
            <FullRecord key={s.code} side={s} />
          ))}
        </div>
      </Disclosure>
    </DetailFrame>
  );
}

const textOf = (v: RecordVersion): string =>
  v.sections.find((s) => s.title === 'Decision')?.content ?? v.sections.find((s) => s.content.trim())?.content ?? '';

/** One side: code + version, when it was approved (and the build state of a task), and its exact sentence. */
function Side({ side }: { side: Loaded }) {
  const t = useMessages(CONFLICT);
  const { detail, v } = side;
  if (!detail || !v) {
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <Code>{side.code}</Code>
        <Bone className="h-12 w-full" />
      </div>
    );
  }
  const build = buildFact(detail.build?.state, detail.build?.pr_url);
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2" data-side={side.code}>
      <figcaption className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm text-fg-2">
        <Code className="whitespace-nowrap">{`${detail.code} v${v.n}`}</Code>
        <span>
          · {v.approved_at ? t.approvedWord : t.draftedWord} <DayTime iso={v.approved_at ?? v.created_at} />
        </span>
        {build ? <span>· {build.kind === 'merged' ? t.builtMerged(build.pr) : t.builtOpen(build.pr)}</span> : null}
      </figcaption>
      {side.quote ? (
        <blockquote className="m-0 max-w-prose border-l-2 border-edge-strong pl-3 text-base text-fg" data-quote>
          “{side.quote}”
        </blockquote>
      ) : (
        <Markdown size="sm" className="line-clamp-4">
          {textOf(v)}
        </Markdown>
      )}
    </figure>
  );
}

/** The whole record, for those who want more than the sentence. */
function FullRecord({ side }: { side: Loaded }) {
  const { detail, v } = side;
  if (!detail || !v) return <Bone className="h-12 w-full" />;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="font-medium text-fg">
        {v.title} <Code className="whitespace-nowrap">{`${detail.code} v${v.n}`}</Code>
      </p>
      <Markdown size="sm">{textOf(v)}</Markdown>
    </div>
  );
}
