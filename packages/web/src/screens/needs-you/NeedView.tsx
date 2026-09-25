// One thing that needs the person, in two sizes: a row of the list and the focus of Catch up. Each
// says what it is, where it comes from and what it unblocks, and has its actions in place. The
// buttons come from the tables; decisive commands ask first; a category is a short choice (the
// design system's Chip).

import { Chip } from '@demiurgo/design-system';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useCommand } from '../../api/commands.ts';
import { keys } from '../../api/queries.ts';
import type { Exploration, ProductRow, Taxonomy } from '../../api/types.ts';
import { dayTime } from '../../lib/time.ts';
import { stateWord, TYPE_WORDS } from '../../words.ts';
import { ActionBar, useAllows } from '../../ui/ActionBar.tsx';
import { Button, buttonClass } from '../../ui/Button.tsx';
import { Code } from '../../ui/Card.tsx';
import { ConfirmDialog, TextDialog } from '../../ui/dialogs.tsx';
import { ArrowRight, RECORD_ICON, TypeIcon, WarningIcon } from '../../ui/icons.tsx';
import { MarkWord } from '../../ui/marks.tsx';
import { QuestionItem } from '../../ui/QuestionItem.tsx';
import { ReadinessBox, Reasons } from '../../ui/Reasons.tsx';
import { WhoMark } from '../../ui/signals.tsx';
import { proposalTitle, PROPOSAL_TYPE_WORDS, rowOf, rowOfVersion } from '../batch/model.ts';
import { Dot, IdeaCheck } from '../batch/parts.tsx';
import { ProposalActions } from '../batch/ProposalActions.tsx';
import { PROPOSAL_ICON, ProposalCard, proposalLine } from '../batch/ProposalCard.tsx';
import { Conflict } from './Conflict.tsx';
import { Frame, type Mode, type NeedContext } from './frame.tsx';
import type { NeedItem } from './order.ts';

/** A thing's title, as the list and Catch up name it. */
export function needTitle(item: NeedItem, rows: readonly ProductRow[]): string {
  switch (item.kind) {
    case 'conflict':
      return conflictTitle(item, rows);
    case 'question':
      return item.question.question;
    case 'package':
      return packageTitle(item);
    case 'proposal':
      return proposalTitle(item.proposal);
    case 'version':
      return item.version.title;
    case 'link':
      return `${item.link.from_title} is based on ${item.link.to_title}`;
    case 'classification':
      return nodeName(item.classification.node_ref, rows);
    case 'update':
      return updateTitle(item, rows);
  }
}

function packageTitle(item: Extract<NeedItem, { kind: 'package' }>): string {
  if (item.batch.type === 'import') return 'Imported from design/';
  const first = item.batch.proposals[0];
  return first ? proposalTitle(first) : 'A package';
}

const VERDICT_WORDS: Record<string, string> = {
  update: 'may need an update',
  invalidate: 'may no longer hold',
  add: 'may need something added',
  other: 'may be affected',
};

function conflictTitle(item: Extract<NeedItem, { kind: 'conflict' }>, rows: readonly ProductRow[]): string {
  const r = item.proposal.payload.record as { code?: string } | undefined;
  const name = rowOf(rows, r?.code ?? '')?.title ?? r?.code ?? 'A record';
  return `${name} ${VERDICT_WORDS[String(item.proposal.payload.verdict)] ?? 'may be affected'}`;
}

function nodeName(ref: string, rows: readonly ProductRow[]): string {
  const code = ref.split('@')[0] ?? ref;
  return rowOf(rows, code)?.title ?? code;
}

function updateTitle(item: Extract<NeedItem, { kind: 'update' }>, rows: readonly ProductRow[]): string {
  const t = item.update.trigger as { type?: string; id?: string; version?: number | null } | null;
  const row = t?.id ? rowOfVersion(rows, t.id) : undefined;
  if (row) return `Knowledge couldn't take in ${row.title}`;
  if (t?.type === 'proposal') return "Knowledge couldn't take in an accepted proposal";
  return "Knowledge couldn't take in a change";
}

export function NeedView({ item, ctx, mode }: { item: NeedItem; ctx: NeedContext; mode: Mode }) {
  switch (item.kind) {
    case 'conflict':
      return <Conflict item={item} ctx={ctx} mode={mode} title={needTitle(item, ctx.rows)} />;
    case 'question':
      return <QuestionNeed item={item} ctx={ctx} mode={mode} />;
    case 'package':
      return <PackageNeed item={item} ctx={ctx} mode={mode} />;
    case 'proposal':
      return <ProposalNeed item={item} ctx={ctx} mode={mode} />;
    case 'version':
      return <VersionNeed item={item} ctx={ctx} mode={mode} />;
    case 'link':
      return <LinkNeed item={item} ctx={ctx} mode={mode} />;
    case 'classification':
      return <ClassificationNeed item={item} ctx={ctx} mode={mode} />;
    case 'update':
      return <UpdateNeed item={item} ctx={ctx} mode={mode} />;
  }
}

function ThreadLink({ projectId, id, threads }: { projectId: string; id: string; threads: readonly Exploration[] }) {
  const t = threads.find((x) => x.id === id);
  return (
    <Link
      to="/p/$projectId/threads/$explorationId"
      params={{ projectId, explorationId: id }}
      className="inline-flex items-center gap-1 font-semibold text-ink-2 hover:text-ink"
    >
      <TypeIcon kind="thread" size={12} />
      {t?.purpose ?? 'its thread'}
    </Link>
  );
}

function QuestionNeed({ item, ctx, mode }: { item: Extract<NeedItem, { kind: 'question' }>; ctx: NeedContext; mode: Mode }) {
  const q = item.question;
  const w = stateWord('question', q.state);
  const blocks = item.unblocks.length > 0;
  return (
    <Frame
      mode={mode}
      item={item}
      ctx={ctx}
      eyebrow={<MarkWord kind={w.mark} word={w.word} />}
      title={q.question}
      line={
        mode === 'focus'
          ? q.state === 'inferred'
            ? 'DEMIURGO assumed an answer from what you said. Confirm it, change it, or park it.'
            : blocks
              ? 'Something waits for your answer before it can be built.'
              : 'It waits for your answer.'
          : undefined
      }
      from={
        <>
          <WhoMark actor={q.raised_by} size={16} />
          <span>{q.raised_by.startsWith('human:') ? 'Asked by you' : 'Asked by DEMIURGO'} in</span>
          <ThreadLink projectId={ctx.projectId} id={q.exploration_id} threads={ctx.threads} />
        </>
      }
    >
      {/* The question's own item: its answer, and Answer, Confirm, Change, Park and Drop from the tables. */}
      <QuestionItem
        projectId={ctx.projectId}
        question={{ ...q }}
        compact={mode === 'row'}
        // The frame already says the question and its mark.
        className="[&>div>div>p:first-child]:hidden [&>div>span:first-child]:hidden"
      />
    </Frame>
  );
}

function PackageNeed({ item, ctx, mode }: { item: Extract<NeedItem, { kind: 'package' }>; ctx: NeedContext; mode: Mode }) {
  const b = item.batch;
  const n = b.proposals.length;
  return (
    <Frame
      mode={mode}
      item={item}
      ctx={ctx}
      eyebrow={
        <>
          <MarkWord kind="proposed" word="Proposed" />
          <span className="text-muted">
            · {n} {n === 1 ? 'proposal' : 'proposals'}, accepted or rejected whole
          </span>
        </>
      }
      title={packageTitle(item)}
      line={b.summary && b.type !== 'import' ? b.summary : undefined}
      from={
        <>
          <WhoMark actor={b.producer} size={16} withName />
          <span>· {dayTime(b.created)}</span>
        </>
      }
    >
      <Link to="/p/$projectId/batches/$batchId" params={{ projectId: ctx.projectId, batchId: b.id }} className={buttonClass()}>
        Open the package <ArrowRight size={13} />
      </Link>
    </Frame>
  );
}

function ProposalNeed({ item, ctx, mode }: { item: Extract<NeedItem, { kind: 'proposal' }>; ctx: NeedContext; mode: Mode }) {
  const p = item.proposal;
  const b = item.batch;
  if (mode === 'focus') {
    return (
      <div data-need={item.key} data-kind={item.kind} className="max-w-[860px]">
        <ProposalCard
          projectId={ctx.projectId}
          proposal={p}
          position={item.position}
          count={b.proposals.length}
          producer={b.producer}
          createdAt={b.created}
          rows={ctx.rows}
        />
      </div>
    );
  }
  const findings = (p.assessment?.findings ?? []).length > 0;
  return (
    <Frame
      mode={mode}
      item={item}
      ctx={ctx}
      eyebrow={
        <>
          <TypeIcon kind={PROPOSAL_ICON[p.type] ?? 'idea'} size={12} />
          {PROPOSAL_TYPE_WORDS[p.type] ?? p.type}
          <Dot />
          <MarkWord kind="proposed" word="Proposed" />
        </>
      }
      title={proposalTitle(p)}
      line={proposalLine(p)}
      from={
        <>
          <WhoMark actor={b.producer} size={16} withName />
          <span>
            · {item.position} of {b.proposals.length} in its batch ·
          </span>
          <Link
            to="/p/$projectId/batches/$batchId"
            params={{ projectId: ctx.projectId, batchId: b.id }}
            className="font-semibold text-ink-2 hover:text-ink"
          >
            Open the batch
          </Link>
        </>
      }
    >
      {findings && <IdeaCheck projectId={ctx.projectId} assessment={p.assessment} rows={ctx.rows} />}
      {p.obsolescence.length > 0 && (
        <p className="dm-text-small flex items-start gap-1.5 text-problem">
          <WarningIcon size={13} className="mt-[3px]" /> {p.obsolescence.join(' ')}
        </p>
      )}
      <ProposalActions projectId={ctx.projectId} proposal={p} blocked={p.obsolescence.length > 0} className="mt-1" />
    </Frame>
  );
}

function VersionNeed({ item, ctx, mode }: { item: Extract<NeedItem, { kind: 'version' }>; ctx: NeedContext; mode: Mode }) {
  const v = item.version;
  const command = useCommand(ctx.projectId);
  const client = useQueryClient();
  const allows = useAllows('record_version', 'draft');
  const [dialog, setDialog] = useState<null | 'approve' | 'discard'>(null);
  const row = rowOf(ctx.rows, v.code);
  const open = (d: 'approve' | 'discard') => {
    command.reset();
    setDialog(d);
  };
  const close = () => {
    if (command.error instanceof ApiError && command.error.status === 409)
      void client.invalidateQueries({ queryKey: keys.project(ctx.projectId) });
    setDialog(null);
  };
  const run = (name: string, data: Record<string, unknown>) =>
    command.mutate({ command: name, entityId: v.id, data }, { onSuccess: () => setDialog(null) });
  return (
    <Frame
      mode={mode}
      item={item}
      ctx={ctx}
      eyebrow={
        <>
          <TypeIcon kind={RECORD_ICON[v.type] ?? 'feature'} size={12} />
          {TYPE_WORDS[v.type]}
          <Dot />
          <MarkWord kind="proposed" word={`v${v.n} Draft`} />
        </>
      }
      title={v.title}
      code={v.code}
      line={mode === 'focus' ? (row?.summary ?? undefined) : undefined}
      from={
        <Link
          to="/p/$projectId/records/$code"
          params={{ projectId: ctx.projectId, code: v.code }}
          search={{ v: v.n }}
          className="inline-flex items-center gap-1 font-semibold text-ink-2 hover:text-ink"
        >
          Read it on its page <ArrowRight size={11} />
        </Link>
      }
    >
      {mode === 'focus' && row?.readiness && row.readiness.reasons.length > 0 && (
        <div className="mb-3">
          <ReadinessBox reasons={row.readiness.reasons} warnings={[]} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2.5">
        {v.approvable && allows('record_version.approve') && (
          <Button variant="primary" data-command="record_version.approve" onClick={() => open('approve')}>
            Approve
          </Button>
        )}
        {allows('record_version.discard') && (
          <Button
            variant={v.approvable ? 'text' : 'secondary'}
            data-command="record_version.discard"
            onClick={() => open('discard')}
          >
            Discard
          </Button>
        )}
        {!v.approvable && (
          <span className="dm-text-caption text-muted">
            A later version is already approved: this draft can only be discarded.
          </span>
        )}
      </div>
      <ConfirmDialog
        open={dialog === 'approve'}
        onOpenChange={(o) => !o && close()}
        title={`Approve “${v.title}” v${v.n}?`}
        description={<p>It becomes the current version of {v.code}. Approving doesn&apos;t create a new version.</p>}
        confirm="Approve"
        pending={command.isPending}
        error={command.error}
        onConfirm={() => run('record_version.approve', {})}
      />
      <TextDialog
        open={dialog === 'discard'}
        onOpenChange={(o) => !o && close()}
        title={`Discard “${v.title}” v${v.n}?`}
        description="The draft stays in the history as discarded. Say why, if you want."
        label="Reason"
        submit="Discard"
        pending={command.isPending}
        error={command.error}
        onSubmit={(text) => run('record_version.discard', text ? { reason: text } : {})}
      />
    </Frame>
  );
}

function LinkNeed({ item, ctx, mode }: { item: Extract<NeedItem, { kind: 'link' }>; ctx: NeedContext; mode: Mode }) {
  const l = item.link;
  const command = useCommand(ctx.projectId);
  const to = rowOf(ctx.rows, l.to_code);
  const newer = to?.current && to.current > l.to_n ? to.current : null;
  const run = (name: string) => command.mutate({ command: name, entityId: l.id, data: {} });
  const w = stateWord('link', l.state);
  return (
    <Frame
      mode={mode}
      item={item}
      ctx={ctx}
      eyebrow={<MarkWord kind={w.mark} word={w.word} />}
      title={`${l.from_title} is based on ${l.to_title}`}
      line={
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Code>
            {l.from_code} v{l.from_n}
          </Code>
          <ArrowRight size={11} className="text-muted" />
          <Code>
            {l.to_code} v{l.to_n}
          </Code>
          <span>
            {newer
              ? `· ${l.to_code} now has v${newer}: does the link still hold?`
              : `· The version it points to changed: does the link still hold?`}
          </span>
        </span>
      }
    >
      <ActionBar
        entity="link"
        state={l.state}
        handlers={{
          'link.keep': { run: (a) => run(a.command), label: 'Keep', variant: 'primary', hint: 'It still holds.' },
          'link.change': { run: (a) => run(a.command), label: 'Mark as changed', hint: 'It holds, with changes.' },
          'link.obsolete': { run: (a) => run(a.command), label: 'Out of date', hint: 'It no longer holds.' },
        }}
      />
      {command.error ? <Reasons error={command.error} className="mt-2" /> : null}
    </Frame>
  );
}

type Axis = { code: string; name: string; categories: { code: string; name: string; description?: string }[] };

/** Categories of the approved taxonomy's axis (a classification is resolved among them). */
export function axisOf(taxonomies: readonly Taxonomy[], axis: string): Axis | null {
  const approved = taxonomies.find((t) => t.state === 'approved');
  const axes = Array.isArray(approved?.axes) ? (approved.axes as Axis[]) : [];
  return axes.find((a) => a.code === axis) ?? null;
}

function ClassificationNeed({
  item,
  ctx,
  mode,
}: {
  item: Extract<NeedItem, { kind: 'classification' }>;
  ctx: NeedContext;
  mode: Mode;
}) {
  const c = item.classification;
  const command = useCommand(ctx.projectId);
  const axis = axisOf(ctx.taxonomies, c.axis);
  const categories = axis?.categories ?? [{ code: c.category, name: c.category }];
  const [chosen, setChosen] = useState(c.category);
  const allows = useAllows('classification', 'pending_review');
  const proposed = categories.find((x) => x.code === c.category)?.name ?? c.category;
  const code = c.node_ref.split('@');
  const w = stateWord('classification', 'pending_review');
  return (
    <Frame
      mode={mode}
      item={item}
      ctx={ctx}
      eyebrow={
        <>
          {axis?.name ?? c.axis}
          <Dot />
          <MarkWord kind={w.mark} word={w.word} />
        </>
      }
      title={nodeName(c.node_ref, ctx.rows)}
      code={code[1] ? `${code[0]} v${code[1]}` : c.node_ref}
      line={`DEMIURGO put it in “${proposed}”, ${Math.round(c.confidence * 100)}% sure: ${c.justification}`}
    >
      {allows('classification.resolve') && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            command.mutate({ command: 'classification.resolve', entityId: c.id, data: { category: chosen } });
          }}
        >
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">Category</legend>
            {/* One category, the chosen one pressed; DEMIURGO's comes chosen. */}
            {categories.map((cat) => (
              <Chip key={cat.code} pressed={chosen === cat.code} title={cat.description} onClick={() => setChosen(cat.code)}>
                {cat.name}
              </Chip>
            ))}
            <Button type="submit" variant="primary" data-command="classification.resolve" disabled={command.isPending}>
              Resolve
            </Button>
          </fieldset>
          {command.error ? <Reasons error={command.error} /> : null}
        </form>
      )}
    </Frame>
  );
}

function UpdateNeed({ item, ctx, mode }: { item: Extract<NeedItem, { kind: 'update' }>; ctx: NeedContext; mode: Mode }) {
  const u = item.update;
  const command = useCommand(ctx.projectId);
  const t = u.trigger as { id?: string; version?: number | null } | null;
  const row = t?.id ? rowOfVersion(ctx.rows, t.id) : undefined;
  const w = stateWord('knowledge_update', 'rejected');
  return (
    <Frame
      mode={mode}
      item={item}
      ctx={ctx}
      eyebrow={<MarkWord kind={w.mark} word={w.word} />}
      title={updateTitle(item, ctx.rows)}
      code={row ? `${row.code}${t?.version ? ` v${t.version}` : ''}` : undefined}
      line={u.failure ?? 'It stopped without saying why.'}
      from={<span>{dayTime(u.created_at)} · Until it is taken in, the knowledge is behind.</span>}
    >
      <ActionBar
        entity="knowledge_update"
        state="rejected"
        handlers={{
          'knowledge_update.retry': {
            run: () => command.mutate({ command: 'knowledge_update.retry', entityId: u.id, data: {} }),
            label: 'Retry',
            variant: 'secondary',
          },
        }}
      />
      {command.error ? <Reasons error={command.error} className="mt-2" /> : null}
    </Frame>
  );
}
