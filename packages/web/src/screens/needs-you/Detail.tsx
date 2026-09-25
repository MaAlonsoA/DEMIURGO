// The detail of the thing selected in Needs you (DESIGN.md §3.1): the full view of each kind, with
// its decision at the bottom. Questions use the one vocabulary of every screen (Answer, Confirm,
// Change first; Park, Drop, Reopen after — §4.4); an assumed answer shows DEMIURGO's reasoning
// before it can be confirmed (INVENTORY Part D §1, UX problem). Buttons come from the tables;
// decisive commands ask first. The page, not the detail, says what a decision did and moves on
// to the next thing (NeedsYou.tsx follows the commands that succeed).

import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client.ts';
import { keys } from '../../api/queries.ts';
import { ActionBar, useAllows } from '../../components/actions.tsx';
import { Code } from '../../components/Badge.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { Card } from '../../components/Card.tsx';
import { ConfirmDialog, PromptDialog } from '../../components/Dialog.tsx';
import { ChoiceGroup } from '../../components/Field.tsx';
import { ArrowRightIcon } from '../../components/icons.tsx';
import { Readiness } from '../../components/Meter.tsx';
import { ErrorNotice, Notice } from '../../components/Notice.tsx';
import { QuestionActions, QuestionOutcome } from '../../components/QuestionActions.tsx';
import { EntityState, StatusBadge } from '../../components/status.tsx';
import { DayTime, RelativeTime } from '../../components/Time.tsx';
import { Who, WhoAvatar } from '../../components/Who.tsx';
import { cn } from '../../lib/cn.ts';
import { TYPE_WORDS, whoOf } from '../../words.ts';
import { proposalTitle, rowOf, rowOfVersion } from '../batch/model.ts';
import { DecisionBar, linkClass, RecordChip } from '../batch/parts.tsx';
import { kindWord } from '../batch/proposal.ts';
import { ProposalView } from '../batch/ProposalView.tsx';
import { AnswerHere } from './AnswerHere.tsx';
import { Conflict } from './Conflict.tsx';
import { DetailFrame, type NeedContext, stageOf, ThreadLink, Unblocks } from './frame.tsx';
import type { NeedItem } from './order.ts';
import { axisOf, needTitle, nodeName, packageTitle, producerWords, updateTitle } from './titles.ts';

export type DetailProps<K extends NeedItem['kind'] = NeedItem['kind']> = {
  item: Extract<NeedItem, { kind: K }>;
  ctx: NeedContext;
  titleId: string;
  /** Catch up's step, Skip and Leave, above the header. */
  top?: React.ReactNode;
};

/** The decision bars stay quiet here: the page says the result, with what is left. */
const QUIET = () => {};

export function NeedDetail(props: DetailProps) {
  const { item } = props;
  switch (item.kind) {
    case 'conflict':
      return <Conflict {...(props as DetailProps<'conflict'>)} title={needTitle(item, props.ctx.rows)} />;
    case 'question':
      return <QuestionDetail {...(props as DetailProps<'question'>)} />;
    case 'package':
      return <PackageDetail {...(props as DetailProps<'package'>)} />;
    case 'proposal':
      return <ProposalDetail {...(props as DetailProps<'proposal'>)} />;
    case 'version':
      return <VersionDetail {...(props as DetailProps<'version'>)} />;
    case 'link':
      return <LinkDetail {...(props as DetailProps<'link'>)} />;
    case 'classification':
      return <ClassificationDetail {...(props as DetailProps<'classification'>)} />;
    case 'update':
      return <UpdateDetail {...(props as DetailProps<'update'>)} />;
  }
}

function QuestionDetail({ item, ctx, titleId, top }: DetailProps<'question'>) {
  const q = item.question;
  const assumed = q.state === 'inferred';
  const parked = q.state === 'postponed';
  // An open or parked question is answered right here, as in its thread.
  const allows = useAllows('question', q.state);
  const answerHere = !assumed && allows('question.confirm');
  const line = assumed
    ? 'DEMIURGO assumed an answer from what you said. Confirm it, change it, or park it.'
    : parked
      ? 'You parked it. It stays open, and what depends on it keeps waiting.'
      : item.unblocks.length > 0
        ? 'Something waits for your answer before it can be built.'
        : 'It waits for your answer.';
  return (
    <DetailFrame
      item={item}
      ctx={ctx}
      titleId={titleId}
      top={top}
      title={q.question}
      state={<EntityState entity="question" state={q.state} />}
      why={
        <>
          <WhoAvatar kind={whoOf(q.raised_by).kind} size={16} />
          <span>{q.raised_by.startsWith('human:') ? 'Asked by you' : 'Asked by DEMIURGO'} in</span>
          <ThreadLink projectId={ctx.projectId} id={q.exploration_id} threads={ctx.threads} />
        </>
      }
      line={line}
      decision={
        <DecisionBar>
          {/* Answer or Confirm, then Change; the ones that set it aside after them (§4.4). */}
          {answerHere ? null : <QuestionActions projectId={ctx.projectId} question={q} hide={['park', 'drop', 'reopen']} />}
          <QuestionActions projectId={ctx.projectId} question={q} hide={['answer', 'confirm', 'change']} className="sm:ml-auto" />
        </DecisionBar>
      }
    >
      {assumed && q.conclusion ? (
        <Card tone="warning" padding="md" className="flex flex-col gap-1.5" data-assumed>
          <p className="text-sm font-medium text-fg">DEMIURGO&apos;s assumed answer</p>
          <p className="text-md text-fg">{q.conclusion}</p>
          {q.reasoning ? (
            <p className="text-sm text-fg-2">
              <span className="font-medium text-fg">Why: </span>
              {q.reasoning}
            </p>
          ) : null}
        </Card>
      ) : null}
      {!assumed ? <QuestionOutcome question={q} /> : null}
      {answerHere ? <AnswerHere key={q.id} projectId={ctx.projectId} question={q} /> : null}
    </DetailFrame>
  );
}

function PackageDetail({ item, ctx, titleId, top }: DetailProps<'package'>) {
  const b = item.batch;
  const n = b.proposals.length;
  const shown = b.proposals.slice(0, 6);
  return (
    <DetailFrame
      item={item}
      ctx={ctx}
      titleId={titleId}
      top={top}
      title={packageTitle(item)}
      state={<StatusBadge kind="proposed" word="Proposed" />}
      eyebrow={`${n} ${n === 1 ? 'proposal' : 'proposals'}, accepted or rejected whole`}
      why={
        <>
          <WhoAvatar kind={whoOf(b.producer).kind} size={16} />
          <span>From {producerWords(b.producer)}</span>
          <span aria-hidden>·</span>
          <RelativeTime iso={b.created} />
        </>
      }
      line={b.summary && b.type !== 'import' ? b.summary : 'It is decided whole, on its own page.'}
      decision={
        <DecisionBar caption="A package is read and decided on its page. Catch up keeps your place while you are there.">
          <Link
            to="/p/$projectId/batches/$batchId"
            params={{ projectId: ctx.projectId, batchId: b.id }}
            className={buttonClass({ variant: 'primary' })}
          >
            Open the package <ArrowRightIcon size={14} />
          </Link>
        </DecisionBar>
      }
    >
      <section className="flex flex-col gap-2" aria-label="What's inside">
        <h3 className="text-sm font-semibold text-fg-2">What&apos;s inside</h3>
        <ul className="flex flex-col divide-y divide-edge-subtle rounded-lg border border-edge">
          {shown.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline gap-x-2 px-3 py-2 text-sm">
              <span className="text-fg-2">{kindWord(p.type)}</span>
              <span className="font-medium text-fg">{proposalTitle(p) || 'Untitled'}</span>
            </li>
          ))}
        </ul>
        {n > shown.length ? <p className="text-sm text-fg-2">and {n - shown.length} more</p> : null}
      </section>
    </DetailFrame>
  );
}

function ProposalDetail({ item, ctx, titleId, top }: DetailProps<'proposal'>) {
  const b = item.batch;
  return (
    <section
      aria-labelledby={titleId}
      data-detail
      data-need={item.key}
      data-kind={item.kind}
      className="flex min-w-0 flex-col gap-5"
    >
      {top}
      <ProposalView
        projectId={ctx.projectId}
        proposal={item.proposal}
        position={item.position}
        count={b.proposals.length}
        producer={b.producer}
        createdAt={b.created}
        runId={b.run_id}
        rows={ctx.rows}
        titleId={titleId}
        onDone={QUIET}
        meta={
          <>
            <span aria-hidden>·</span>
            <Link
              to="/p/$projectId/batches/$batchId"
              params={{ projectId: ctx.projectId, batchId: b.id }}
              className={cn(linkClass, 'inline-flex min-h-6 items-center')}
            >
              Open the batch
            </Link>
          </>
        }
      >
        <Unblocks ctx={ctx} item={item} />
      </ProposalView>
    </section>
  );
}

function VersionDetail({ item, ctx, titleId, top }: DetailProps<'version'>) {
  const v = item.version;
  const command = useCommand(ctx.projectId);
  const client = useQueryClient();
  const allows = useAllows('record_version', 'draft');
  const [dialog, setDialog] = useState<null | 'approve' | 'discard'>(null);
  const row = rowOf(ctx.rows, v.code);
  const reasons = row?.readiness?.reasons ?? [];
  const open = (d: 'approve' | 'discard') => {
    command.reset();
    setDialog(d);
  };
  const close = () => {
    if (command.error instanceof ApiError && command.error.status === 409)
      void client.invalidateQueries({ queryKey: keys.project(ctx.projectId) });
    setDialog(null);
  };
  // mutateAsync: the draft leaves Needs you, and this detail with it, before mutate's callbacks.
  const run = (name: string, data: Record<string, unknown>) => {
    void command.mutateAsync({ command: name, entityId: v.id, data }).then(
      () => setDialog(null),
      () => {
        // Shown in the dialog.
      },
    );
  };
  return (
    <DetailFrame
      item={item}
      ctx={ctx}
      titleId={titleId}
      top={top}
      title={v.title}
      code={`${v.code} v${v.n}`}
      state={<StatusBadge kind="proposed" word={`v${v.n} Draft`} />}
      eyebrow={TYPE_WORDS[v.type]}
      why={
        <Link
          to="/p/$projectId/records/$code"
          params={{ projectId: ctx.projectId, code: v.code }}
          search={{ v: v.n }}
          className={cn(linkClass, 'inline-flex min-h-6 items-center gap-1')}
        >
          Read it on its page <ArrowRightIcon size={13} />
        </Link>
      }
      line={row?.summary || undefined}
      decision={
        <DecisionBar
          caption={
            v.approvable ? (
              "Approving makes it the current version. It doesn't create a new version."
            ) : (
              <span data-reason>A later version is already approved: this draft can only be discarded.</span>
            )
          }
        >
          {allows('record_version.approve') ? (
            v.approvable ? (
              <Button variant="primary" data-command="record_version.approve" onClick={() => open('approve')}>
                Approve
              </Button>
            ) : (
              <Button variant="primary" data-command="record_version.approve" aria-disabled="true" onClick={() => {}}>
                Approve
              </Button>
            )
          ) : null}
          {allows('record_version.discard') ? (
            <Button
              variant={v.approvable ? 'quiet-danger' : 'secondary'}
              data-command="record_version.discard"
              onClick={() => open('discard')}
            >
              Discard
            </Button>
          ) : null}
        </DecisionBar>
      }
    >
      {row?.readiness ? (
        <section className="flex flex-col gap-2" aria-label="Readiness">
          <h3 className="text-sm font-semibold text-fg-2">Before it can be built</h3>
          <div>
            <Readiness stage={stageOf(row)} blocking={reasons.length} />
          </div>
          {reasons.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-fg-2">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      <ConfirmDialog
        open={dialog === 'approve'}
        onOpenChange={(o) => !o && close()}
        title={`Approve “${v.title}” v${v.n}?`}
        description={<p>It becomes the current version of {v.code}. Approving doesn&apos;t create a new version.</p>}
        confirm="Approve"
        pendingLabel="Approving…"
        pending={command.isPending}
        error={dialog === 'approve' ? command.error : null}
        onConfirm={() => run('record_version.approve', {})}
      />
      <PromptDialog
        open={dialog === 'discard'}
        onOpenChange={(o) => !o && close()}
        title={`Discard “${v.title}” v${v.n}?`}
        description="The draft stays in the history as discarded. Say why, if you want."
        label="Reason"
        submit="Discard"
        pendingLabel="Discarding…"
        tone="danger"
        maxLength={2000}
        pending={command.isPending}
        error={dialog === 'discard' ? command.error : null}
        onSubmit={(text) => run('record_version.discard', text ? { reason: text } : {})}
      />
    </DetailFrame>
  );
}

function LinkDetail({ item, ctx, titleId, top }: DetailProps<'link'>) {
  const l = item.link;
  const command = useCommand(ctx.projectId);
  const [confirm, setConfirm] = useState(false);
  const to = rowOf(ctx.rows, l.to_code);
  const newer = to?.current && to.current > l.to_n ? to.current : null;
  const running = command.isPending ? command.variables?.command : undefined;
  const run = (name: string) => {
    void command.mutateAsync({ command: name, entityId: l.id, data: {} }).then(
      () => setConfirm(false),
      () => {
        // Shown in the decision bar, or in the dialog.
      },
    );
  };
  return (
    <DetailFrame
      item={item}
      ctx={ctx}
      titleId={titleId}
      top={top}
      title={`${l.from_title} is based on ${l.to_title}`}
      state={<EntityState entity="link" state={l.state} />}
      why={
        <>
          <RecordChip projectId={ctx.projectId} code={l.from_code} version={l.from_n} rows={ctx.rows} />
          <ArrowRightIcon size={13} className="text-fg-3" />
          <RecordChip projectId={ctx.projectId} code={l.to_code} version={l.to_n} rows={ctx.rows} />
        </>
      }
      line={
        newer
          ? `${l.to_code} now has v${newer}: does the link still hold?`
          : 'The version it points to changed: does the link still hold?'
      }
      decision={
        <DecisionBar
          caption={
            <ul className="flex flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:gap-x-4">
              <li>
                <span className="font-medium text-fg">Keep:</span> it still holds.
              </li>
              <li>
                <span className="font-medium text-fg">Mark as changed:</span> it holds, with changes.
              </li>
              <li>
                <span className="font-medium text-fg">Out of date:</span> it no longer holds.
              </li>
            </ul>
          }
          error={!confirm && command.error ? <ErrorNotice error={command.error} compact /> : null}
        >
          <ActionBar
            entity="link"
            state={l.state}
            handlers={{
              'link.keep': {
                run: (a) => run(a.command),
                label: 'Keep',
                variant: 'primary',
                pending: running === 'link.keep',
                pendingLabel: 'Keeping…',
                disabled: command.isPending,
              },
              'link.change': {
                run: (a) => run(a.command),
                label: 'Mark as changed',
                variant: 'secondary',
                pending: running === 'link.change',
                pendingLabel: 'Marking…',
                disabled: command.isPending,
              },
              'link.obsolete': {
                run: () => {
                  command.reset();
                  setConfirm(true);
                },
                label: 'Out of date',
                variant: 'quiet-danger',
                disabled: command.isPending,
              },
            }}
          />
        </DecisionBar>
      }
    >
      <ConfirmDialog
        open={confirm}
        onOpenChange={(o) => !o && setConfirm(false)}
        title="Mark this link out of date?"
        description={
          <p>
            “{l.from_title}” stops being based on “{l.to_title}”. New versions of {l.from_code} won&apos;t carry this link.
          </p>
        }
        confirm="Out of date"
        pendingLabel="Marking…"
        tone="danger"
        pending={command.isPending}
        error={confirm ? command.error : null}
        onConfirm={() => run('link.obsolete')}
      />
    </DetailFrame>
  );
}

function ClassificationDetail({ item, ctx, titleId, top }: DetailProps<'classification'>) {
  const c = item.classification;
  const command = useCommand(ctx.projectId);
  const axis = axisOf(ctx.taxonomies, c.axis);
  const categories = axis?.categories ?? [{ code: c.category, name: c.category }];
  const [chosen, setChosen] = useState(c.category);
  const allows = useAllows('classification', 'pending_review');
  const proposed = categories.find((x) => x.code === c.category)?.name ?? c.category;
  const [code, version] = c.node_ref.split('@');
  return (
    <DetailFrame
      item={item}
      ctx={ctx}
      titleId={titleId}
      top={top}
      title={nodeName(c.node_ref, ctx.rows)}
      code={version ? `${code} v${version}` : c.node_ref}
      state={<EntityState entity="classification" state="pending_review" />}
      eyebrow={axis?.name ?? c.axis}
      line={`DEMIURGO put it in “${proposed}”, ${Math.round(c.confidence * 100)}% sure: ${c.justification}`}
      decision={
        allows('classification.resolve') ? (
          <DecisionBar error={command.error ? <ErrorNotice error={command.error} compact /> : null}>
            <Button
              variant="primary"
              data-command="classification.resolve"
              pending={command.isPending}
              pendingLabel="Resolving…"
              onClick={() => command.mutate({ command: 'classification.resolve', entityId: c.id, data: { category: chosen } })}
            >
              Resolve
            </Button>
          </DecisionBar>
        ) : null
      }
    >
      {axis ? null : (
        <Notice tone="info" title="There is no approved taxonomy yet">
          You can only confirm the category DEMIURGO chose. Approve a taxonomy in Knowledge to choose among its categories.
        </Notice>
      )}
      <ChoiceGroup
        legend="Where it goes"
        name={`classification-${c.id}`}
        value={[chosen]}
        onChange={(v) => setChosen(v[0] ?? c.category)}
        columns={2}
        choices={categories.map((cat) => ({
          value: cat.code,
          label: cat.code === c.category ? `${cat.name} · DEMIURGO's choice` : cat.name,
          ...('description' in cat && cat.description ? { detail: cat.description } : {}),
        }))}
      />
    </DetailFrame>
  );
}

function UpdateDetail({ item, ctx, titleId, top }: DetailProps<'update'>) {
  const u = item.update;
  const command = useCommand(ctx.projectId);
  const t = u.trigger as { id?: string; version?: number | null } | null;
  const row = t?.id ? rowOfVersion(ctx.rows, t.id) : undefined;
  return (
    <DetailFrame
      item={item}
      ctx={ctx}
      titleId={titleId}
      top={top}
      title={updateTitle(item, ctx.rows)}
      code={row ? `${row.code}${t?.version ? ` v${t.version}` : ''}` : undefined}
      state={<EntityState entity="knowledge_update" state="rejected" />}
      why={
        <>
          <Who actor="system:knowledge" size={16} />
          <span aria-hidden>·</span>
          <DayTime iso={u.created_at} />
          <span aria-hidden>·</span>
          <span>Until it is taken in, the knowledge is behind.</span>
        </>
      }
      decision={
        <DecisionBar error={command.error ? <ErrorNotice error={command.error} compact /> : null}>
          <ActionBar
            entity="knowledge_update"
            state="rejected"
            handlers={{
              'knowledge_update.retry': {
                run: () => command.mutate({ command: 'knowledge_update.retry', entityId: u.id, data: {} }),
                label: 'Retry',
                variant: 'primary',
                pending: command.isPending,
                pendingLabel: 'Retrying…',
              },
            }}
          />
        </DecisionBar>
      }
    >
      <Card padding="sm" className="flex flex-col gap-1">
        <p className="text-sm font-medium text-fg">What happened</p>
        <p className="text-sm text-fg-2">{u.failure ?? 'It stopped without saying why.'}</p>
        {row ? (
          <p className="text-sm text-fg-2">
            The change: <Code>{row.code}</Code> {row.title}
          </p>
        ) : null}
      </Card>
    </DetailFrame>
  );
}

/** Used by the page to say what a result means for the rest ("Answered. 3 left in Needs you."). */
export function saidWithCount(said: string, left: number): string {
  if (left === 0) return `${said} Nothing else needs you.`;
  return `${said} ${left} left in Needs you.`;
}
