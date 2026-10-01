// The detail of a thing of Needs you with no home yet (conflict, link, classification, failed
// update), with its decision at the bottom; and, in Catch up, the step that points a thing with a
// home to where it is decided. The page says what a decision did and moves on to the next thing
// (NeedsYou.tsx follows the commands that succeed).

import { useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { ActionBar, useAllows } from '../../components/actions.tsx';
import { Code } from '../../components/Badge.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { Card } from '../../components/Card.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { ChoiceGroup } from '../../components/Field.tsx';
import { ArrowRightIcon } from '../../components/icons.tsx';
import { ErrorNotice, Notice } from '../../components/Notice.tsx';
import { EntityState } from '../../components/status.tsx';
import { DayTime } from '../../components/Time.tsx';
import { Who } from '../../components/Who.tsx';
import { useMessages } from '../../i18n/define.ts';
import { rowOf, rowOfVersion } from '../batch/model.ts';
import { ProposalDecision } from '../batch/ProposalActions.tsx';
import { BlockedNotice, DecisionBar, RecordChip } from '../batch/parts.tsx';
import { Conflict } from './Conflict.tsx';
import { DetailFrame, type NeedContext } from './frame.tsx';
import type { NeedItem } from './order.ts';
import { HomeLink, homeOf } from './home.tsx';
import { SuspectActions } from '../record/SuspectActions.tsx';
import { axisOf, needReason, needTitle, nodeName, updateTitle } from './titles.ts';
import { DETAIL, TITLES } from './words.i18n.ts';

export type DetailProps<K extends NeedItem['kind'] = NeedItem['kind']> = {
  item: Extract<NeedItem, { kind: K }>;
  ctx: NeedContext;
  titleId: string;
  /** Catch up's step, Skip and Leave, above the header. */
  top?: React.ReactNode;
};

export function NeedDetail(props: DetailProps) {
  const { item } = props;
  const kindWords = useMessages(TITLES);
  switch (item.kind) {
    case 'next_step':
      return <GoDetail {...props} />;
    case 'conflict':
      return <Conflict {...(props as DetailProps<'conflict'>)} title={needTitle(item, props.ctx.rows, kindWords)} />;
    case 'question':
    case 'package':
    case 'proposal':
    case 'version':
      return <GoDetail {...props} />;
    case 'link':
      return <LinkDetail {...(props as DetailProps<'link'>)} />;
    case 'suspect':
      return <SuspectDetail {...(props as DetailProps<'suspect'>)} />;
    case 'classification':
      return <ClassificationDetail {...(props as DetailProps<'classification'>)} />;
    case 'update':
      return <UpdateDetail {...(props as DetailProps<'update'>)} />;
  }
}

/** A thing with a home: Catch up's step points there, where it is decided. */
function GoDetail({ item, ctx, titleId, top }: DetailProps) {
  const t = useMessages(DETAIL);
  const kindWords = useMessages(TITLES);
  const home = homeOf(item);
  // One proposal decided item by item is decided right here (accept, approve, reject), with the
  // same bar as its batch page; «Open it» keeps the detail one click away.
  const inPlace = item.kind === 'proposal' && item.proposal.state === 'pending' ? item.proposal : null;
  if (inPlace && item.kind === 'proposal') {
    const warnings = inPlace.obsolescence ?? [];
    return (
      <DetailFrame
        item={item}
        ctx={ctx}
        titleId={titleId}
        top={top}
        title={needTitle(item, ctx.rows, kindWords)}
        line={needReason(item, ctx, kindWords)}
        decision={
          <>
            <BlockedNotice reasons={warnings} />
            <ProposalDecision projectId={ctx.projectId} proposal={inPlace} blocked={warnings} sticky={false} onDone={() => {}} />
            {home ? (
              <HomeLink projectId={ctx.projectId} home={home} className={buttonClass({ variant: 'quiet' })}>
                {t.openIt} <ArrowRightIcon size={14} />
              </HomeLink>
            ) : null}
          </>
        }
      />
    );
  }
  return (
    <DetailFrame
      item={item}
      ctx={ctx}
      titleId={titleId}
      top={top}
      title={needTitle(item, ctx.rows, kindWords)}
      line={needReason(item, ctx, kindWords)}
      decision={
        home ? (
          <DecisionBar caption={t.decidedOnItsPage}>
            <HomeLink projectId={ctx.projectId} home={home} className={buttonClass({ variant: 'primary' })}>
              {t.goDecide} <ArrowRightIcon size={14} />
            </HomeLink>
          </DecisionBar>
        ) : null
      }
    />
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

function SuspectDetail({ item, ctx, titleId, top }: DetailProps<'suspect'>) {
  const t = useMessages(DETAIL);
  const kindWords = useMessages(TITLES);
  const s = item.suspect;
  return (
    <DetailFrame
      item={item}
      ctx={ctx}
      titleId={titleId}
      top={top}
      title={needTitle(item, ctx.rows, kindWords)}
      code={`${s.from_code} v${s.from_n}`}
      why={
        <>
          <RecordChip projectId={ctx.projectId} code={s.from_code} version={s.from_n} rows={ctx.rows} />
          <ArrowRightIcon size={13} className="text-fg-3" />
          <RecordChip projectId={ctx.projectId} code={s.suspect.upstream} version={s.suspect.to} rows={ctx.rows} />
        </>
      }
      line={t.suspectLine(s.suspect.upstream, s.suspect.from, s.suspect.to)}
      decision={
        <DecisionBar>
          <SuspectActions
            projectId={ctx.projectId}
            linkId={s.link_id}
            versionId={s.from_version_id}
            code={s.from_code}
            n={s.from_n}
            suspect={s.suspect}
          />
        </DecisionBar>
      }
    />
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
