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
import { useMessages } from '../../i18n/define.ts';
import { cn } from '../../lib/cn.ts';
import { whoOf } from '../../words.ts';
import { proposalTitle, rowOf, rowOfVersion } from '../batch/model.ts';
import { DecisionBar, linkClass, RecordChip } from '../batch/parts.tsx';
import { ProposalKind } from '../../components/AspectTag.tsx';
import { ProposalView } from '../batch/ProposalView.tsx';
import { AnswerHere } from './AnswerHere.tsx';
import { Conflict } from './Conflict.tsx';
import { DetailFrame, type NeedContext, stageOf, ThreadLink, Unblocks } from './frame.tsx';
import type { NeedItem } from './order.ts';
import { axisOf, needTitle, nodeName, packageTitle, producerWords, updateTitle } from './titles.ts';
import { DETAIL, TITLES } from './words.i18n.ts';

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
  const kindWords = useMessages(TITLES);
  switch (item.kind) {
    case 'conflict':
      return <Conflict {...(props as DetailProps<'conflict'>)} title={needTitle(item, props.ctx.rows, kindWords)} />;
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
  const t = useMessages(DETAIL);
  const q = item.question;
  const assumed = q.state === 'inferred';
  const parked = q.state === 'postponed';
  // An open or parked question is answered right here, as in its thread.
  const allows = useAllows('question', q.state);
  const answerHere = !assumed && allows('question.confirm');
  const line = assumed
    ? t.questionAssumedLine
    : parked
      ? t.questionParkedLine
      : item.unblocks.length > 0
        ? t.questionUnblocksLine
        : t.questionWaitsLine;
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
          <span>{t.askedByPrefix(q.raised_by.startsWith('human:'))}</span>
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
          <p className="text-sm font-medium text-fg">{t.assumedAnswerTitle}</p>
          <p className="text-md text-fg">{q.conclusion}</p>
          {q.reasoning ? (
            <p className="text-sm text-fg-2">
              <span className="font-medium text-fg">{t.whyLabel} </span>
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
  const t = useMessages(DETAIL);
  const kindWords = useMessages(TITLES);
  const b = item.batch;
  const n = b.proposals.length;
  const shown = b.proposals.slice(0, 6);
  return (
    <DetailFrame
      item={item}
      ctx={ctx}
      titleId={titleId}
      top={top}
      title={packageTitle(item, kindWords)}
      state={<StatusBadge kind="proposed" word={t.proposedWord} />}
      eyebrow={t.packageEyebrow(n)}
      why={
        <>
          <WhoAvatar kind={whoOf(b.producer).kind} size={16} />
          <span>
            {t.fromWord} {producerWords(b.producer, kindWords)}
          </span>
          <span aria-hidden>·</span>
          <RelativeTime iso={b.created} />
        </>
      }
      line={b.summary && b.type !== 'import' ? b.summary : t.packageLineFallback}
      decision={
        <DecisionBar caption={t.packageCaption}>
          <Link
            to="/p/$projectId/batches/$batchId"
            params={{ projectId: ctx.projectId, batchId: b.id }}
            className={buttonClass({ variant: 'primary' })}
          >
            {t.openPackage} <ArrowRightIcon size={14} />
          </Link>
        </DecisionBar>
      }
    >
      <section className="flex flex-col gap-2" aria-label={t.whatsInside}>
        <h3 className="text-sm font-semibold text-fg-2">{t.whatsInside}</h3>
        <ul className="flex flex-col divide-y divide-edge-subtle rounded-lg border border-edge">
          {shown.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline gap-x-2 px-3 py-2 text-sm">
              <ProposalKind proposal={p} className="inline-flex items-center gap-1.5 text-fg-2" />
              <span className="font-medium text-fg">{proposalTitle(p) || t.untitled}</span>
            </li>
          ))}
        </ul>
        {n > shown.length ? <p className="text-sm text-fg-2">{t.andMore(n - shown.length)}</p> : null}
      </section>
    </DetailFrame>
  );
}

function ProposalDetail({ item, ctx, titleId, top }: DetailProps<'proposal'>) {
  const t = useMessages(DETAIL);
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
              {t.openBatch}
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
  const t = useMessages(DETAIL);
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
      state={<StatusBadge kind="proposed" word={t.draftWord(v.n)} />}
      why={
        <Link
          to="/p/$projectId/records/$code"
          params={{ projectId: ctx.projectId, code: v.code }}
          search={{ v: v.n }}
          className={cn(linkClass, 'inline-flex min-h-6 items-center gap-1')}
        >
          {t.readOnItsPage} <ArrowRightIcon size={13} />
        </Link>
      }
      line={row?.summary || undefined}
      decision={
        <DecisionBar caption={v.approvable ? t.approvableCaption : <span data-reason>{t.notApprovableCaption}</span>}>
          {allows('record_version.approve') ? (
            v.approvable ? (
              <Button variant="primary" data-command="record_version.approve" onClick={() => open('approve')}>
                {t.approve}
              </Button>
            ) : (
              <Button variant="primary" data-command="record_version.approve" aria-disabled="true" onClick={() => {}}>
                {t.approve}
              </Button>
            )
          ) : null}
          {allows('record_version.discard') ? (
            <Button
              variant={v.approvable ? 'quiet-danger' : 'secondary'}
              data-command="record_version.discard"
              onClick={() => open('discard')}
            >
              {t.discard}
            </Button>
          ) : null}
        </DecisionBar>
      }
    >
      {row?.readiness ? (
        <section className="flex flex-col gap-2" aria-label={t.readinessLabel}>
          <h3 className="text-sm font-semibold text-fg-2">{t.beforeBuilt}</h3>
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
        title={t.approveTitle(v.title, v.n)}
        description={<p>{t.approveDescription(v.code)}</p>}
        confirm={t.approve}
        pendingLabel={t.approving}
        pending={command.isPending}
        error={dialog === 'approve' ? command.error : null}
        onConfirm={() => run('record_version.approve', {})}
      />
      <PromptDialog
        open={dialog === 'discard'}
        onOpenChange={(o) => !o && close()}
        title={t.discardTitle(v.title, v.n)}
        description={t.discardDescription}
        label={t.reasonLabel}
        submit={t.discard}
        pendingLabel={t.discarding}
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
  const t = useMessages(DETAIL);
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
      title={t.linkTitle(l.from_title, l.to_title)}
      state={<EntityState entity="link" state={l.state} />}
      why={
        <>
          <RecordChip projectId={ctx.projectId} code={l.from_code} version={l.from_n} rows={ctx.rows} />
          <ArrowRightIcon size={13} className="text-fg-3" />
          <RecordChip projectId={ctx.projectId} code={l.to_code} version={l.to_n} rows={ctx.rows} />
        </>
      }
      line={newer ? t.linkNewerLine(l.to_code, newer) : t.linkChangedLine}
      decision={
        <DecisionBar
          caption={
            <ul className="flex flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:gap-x-4">
              <li>
                <span className="font-medium text-fg">{t.keepLabel}</span> {t.keepDesc}
              </li>
              <li>
                <span className="font-medium text-fg">{t.changeLabel}</span> {t.changeDesc}
              </li>
              <li>
                <span className="font-medium text-fg">{t.obsoleteLabel}</span> {t.obsoleteDesc}
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
                label: t.keep,
                variant: 'primary',
                pending: running === 'link.keep',
                pendingLabel: t.keeping,
                disabled: command.isPending,
              },
              'link.change': {
                run: (a) => run(a.command),
                label: t.markChanged,
                variant: 'secondary',
                pending: running === 'link.change',
                pendingLabel: t.marking,
                disabled: command.isPending,
              },
              'link.obsolete': {
                run: () => {
                  command.reset();
                  setConfirm(true);
                },
                label: t.outOfDate,
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
        title={t.confirmOutOfDateTitle}
        description={<p>{t.confirmOutOfDateDescription(l.from_title, l.to_title, l.from_code)}</p>}
        confirm={t.outOfDate}
        pendingLabel={t.marking}
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
  const t = useMessages(DETAIL);
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
      line={t.classificationLine(proposed, Math.round(c.confidence * 100), c.justification)}
      decision={
        allows('classification.resolve') ? (
          <DecisionBar error={command.error ? <ErrorNotice error={command.error} compact /> : null}>
            <Button
              variant="primary"
              data-command="classification.resolve"
              pending={command.isPending}
              pendingLabel={t.resolving}
              onClick={() => command.mutate({ command: 'classification.resolve', entityId: c.id, data: { category: chosen } })}
            >
              {t.resolve}
            </Button>
          </DecisionBar>
        ) : null
      }
    >
      {axis ? null : (
        <Notice tone="info" title={t.noTaxonomyTitle}>
          {t.noTaxonomyBody}
        </Notice>
      )}
      <ChoiceGroup
        legend={t.whereItGoes}
        name={`classification-${c.id}`}
        value={[chosen]}
        onChange={(v) => setChosen(v[0] ?? c.category)}
        columns={2}
        choices={categories.map((cat) => ({
          value: cat.code,
          label: cat.code === c.category ? t.demiurgoChoice(cat.name) : cat.name,
          ...('description' in cat && cat.description ? { detail: cat.description } : {}),
        }))}
      />
    </DetailFrame>
  );
}

function UpdateDetail({ item, ctx, titleId, top }: DetailProps<'update'>) {
  const t = useMessages(DETAIL);
  const kindWords = useMessages(TITLES);
  const u = item.update;
  const command = useCommand(ctx.projectId);
  const trigger = u.trigger as { id?: string; version?: number | null } | null;
  const row = trigger?.id ? rowOfVersion(ctx.rows, trigger.id) : undefined;
  return (
    <DetailFrame
      item={item}
      ctx={ctx}
      titleId={titleId}
      top={top}
      title={updateTitle(item, ctx.rows, kindWords)}
      code={row ? `${row.code}${trigger?.version ? ` v${trigger.version}` : ''}` : undefined}
      state={<EntityState entity="knowledge_update" state="rejected" />}
      why={
        <>
          <Who actor="system:knowledge" size={16} />
          <span aria-hidden>·</span>
          <DayTime iso={u.created_at} />
          <span aria-hidden>·</span>
          <span>{t.updateReasonLine}</span>
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
                label: t.retry,
                variant: 'primary',
                pending: command.isPending,
                pendingLabel: t.retrying,
              },
            }}
          />
        </DecisionBar>
      }
    >
      <Card padding="sm" className="flex flex-col gap-1">
        <p className="text-sm font-medium text-fg">{t.whatHappened}</p>
        <p className="text-sm text-fg-2">{u.failure ?? t.stoppedNoReason}</p>
        {row ? (
          <p className="text-sm text-fg-2">
            {t.theChangeLabel} <Code>{row.code}</Code> {row.title}
          </p>
        ) : null}
      </Card>
    </DetailFrame>
  );
}

/** Used by the page to say what a result means for the rest ("Answered. 3 left in Needs you."). */
export function saidWithCount(said: string, left: number, words: typeof DETAIL.en = DETAIL.en): string {
  if (left === 0) return words.nothingElse(said);
  return words.leftCount(said, left);
}
