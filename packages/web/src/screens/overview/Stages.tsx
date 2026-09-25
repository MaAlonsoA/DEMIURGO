// The product's design stages (DESIGN.md §3.5, INV-OVW-06…08): a horizontal stepper of the fixed
// stages — each with its state in words and "x of y answered" — whose steps are tabs (APG, R96):
// choosing one shows its detail below, with what it produces, a meter, and its actions (Open
// thread, Pass stage on the open one). "Start design stages" when none has started. Passing is
// decisive, so it asks first; when its questions aren't all answered it says why it may not pass
// yet in words, instead of relying on the button's style. The server still has the last word.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Tabs as T } from 'radix-ui';
import { useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { stagesQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import type { StageRow } from '../../api/types.ts';
import { useActions } from '../../components/actions.tsx';
import { announce } from '../../components/announce.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { CheckCircleIcon, CheckIcon, CircleDashedIcon, CircleHalfIcon, InfoIcon } from '../../components/icons.tsx';
import { Meter } from '../../components/Meter.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { Section } from '../../components/Page.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { TONE } from '../../components/status.tsx';
import { DayTime } from '../../components/Time.tsx';
import { whoName } from '../../components/Who.tsx';
import { cn } from '../../lib/cn.ts';
import { useTables } from '../../lib/hooks.ts';
import { whoOf } from '../../words.ts';
import { useReturnFocus } from '../record/returnFocus.ts';

const STAGE_LOOK = {
  not_started: { word: 'Not started', tone: TONE.neutral, Icon: CircleDashedIcon },
  open: { word: 'Open', tone: TONE.info, Icon: CircleHalfIcon },
  passed: { word: 'Passed', tone: TONE.success, Icon: CheckCircleIcon },
} as const;

/** The state of a stage as a badge: icon, word and tone (DESIGN.md §4.3: not started, open, passed). */
function StageBadge({ state }: { state: StageRow['state'] }) {
  const look = STAGE_LOOK[state];
  return (
    <span
      data-status={state}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-xs font-medium whitespace-nowrap',
        look.tone.soft,
        look.tone.text,
        look.tone.edge,
      )}
    >
      <look.Icon size={12} className={look.tone.icon} />
      {look.word}
    </span>
  );
}

/** The number of a step in its circle; a check once passed. */
function StepMark({ stage }: { stage: StageRow }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
        stage.state === 'passed' && 'border-success-edge bg-success-soft text-success-text',
        stage.state === 'open' && 'border-2 border-info bg-panel text-info-text',
        stage.state === 'not_started' && 'border-edge-strong bg-panel text-fg-2',
      )}
    >
      {stage.state === 'passed' ? <CheckIcon size={13} /> : stage.position + 1}
    </span>
  );
}

export function DesignStages({ projectId }: { projectId: string }) {
  const stages = useQuery(stagesQuery(projectId));
  const tables = useTables();
  const start = useCommand(projectId);
  const list = stages.data ?? [];
  const started = list.some((s) => s.state !== 'not_started');
  const current = list.find((s) => s.state === 'open');
  const first = list[0];
  const canStart = !started && !!first && !!tables && canCreate(tables, 'stage.open');
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = list.find((s) => s.key === chosen) ?? current ?? list.find((s) => s.state === 'not_started') ?? list.at(-1);

  return (
    <Section
      id="design-stages"
      title={
        <>
          Product design
          {current ? <span className="font-normal text-fg-2"> · now: {current.title}</span> : null}
        </>
      }
      note="What holds for the whole product. Each feature then has its own requirements, checks and Ready to build."
      actions={
        canStart ? (
          <Button
            pending={start.isPending}
            pendingLabel="Starting…"
            onClick={() =>
              start.mutate(
                { command: 'stage.open', data: { stage: first.key } },
                { onSuccess: () => announce(`Design stages started: ${first.title} is open.`) },
              )
            }
          >
            Start design stages
          </Button>
        ) : null
      }
    >
      <div data-design-stages className="flex flex-col gap-3">
        {start.error ? <ErrorNotice error={start.error} /> : null}
        {stages.error ? (
          <ErrorNotice error={stages.error} onRetry={() => void stages.refetch()} />
        ) : !stages.data ? (
          <Skeleton label="Loading the design stages">
            <div className="grid gap-2 sm:grid-cols-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <Bone key={i} className="h-24 rounded-lg" />
              ))}
            </div>
          </Skeleton>
        ) : list.length === 0 ? null : (
          <T.Root value={selected?.key ?? ''} onValueChange={setChosen} className="flex flex-col gap-3">
            <T.List aria-label="Design stages" className="grid gap-2 sm:grid-cols-5">
              {list.map((s) => (
                <T.Trigger
                  key={s.key}
                  value={s.key}
                  data-stage={s.key}
                  data-stage-state={s.state}
                  aria-current={s.state === 'open' ? 'step' : undefined}
                  className={cn(
                    'flex min-w-0 cursor-pointer flex-row flex-wrap items-center gap-2 rounded-lg border bg-panel p-2.5 text-left transition-colors duration-[var(--m-fast)] sm:flex-col sm:flex-nowrap sm:items-start',
                    'border-edge hover:border-edge-strong data-[state=active]:border-accent data-[state=active]:bg-selected',
                  )}
                >
                  <span className="flex min-w-0 flex-1 items-start gap-2 sm:flex-none">
                    <StepMark stage={s} />
                    <span className="line-clamp-2 text-sm leading-snug font-medium text-fg">{s.title}</span>
                  </span>
                  <StageBadge state={s.state} />
                  <span className="flex flex-col gap-1 sm:w-full">
                    <span aria-hidden className="hidden h-1 w-full overflow-hidden rounded-full bg-hover sm:block">
                      <span
                        className={cn('block h-full rounded-full', s.state === 'passed' ? 'bg-success' : 'bg-info')}
                        style={{ width: `${s.total > 0 ? Math.round((Math.min(s.covered, s.total) / s.total) * 100) : 0}%` }}
                      />
                    </span>
                    <span className="text-xs text-fg-2 tabular-nums">
                      {s.covered} of {s.total} answered
                    </span>
                  </span>
                </T.Trigger>
              ))}
            </T.List>
            {list.map((s, i) => (
              <T.Content key={s.key} value={s.key} className="outline-none focus-visible:outline-2">
                <StageDetail projectId={projectId} stage={s} next={list[i + 1]} />
              </T.Content>
            ))}
          </T.Root>
        )}
      </div>
    </Section>
  );
}

function StageDetail({ projectId, stage: s, next }: { projectId: string; stage: StageRow; next: StageRow | undefined }) {
  const command = useCommand(projectId);
  const actions = useActions('stage', s.state === 'not_started' ? undefined : s.state);
  const [confirming, setConfirming] = useState(false);
  const focus = useReturnFocus();
  const canPass = s.state === 'open' && !!s.id && actions.some((a) => a.command === 'stage.pass');
  const missing = Math.max(0, s.total - s.covered);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-edge bg-panel p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold text-fg">
          Stage {s.position + 1} · {s.title}
        </h3>
        <StageBadge state={s.state} />
      </div>
      <p className="text-sm text-fg-2">{s.produces}</p>
      <Meter
        value={s.covered}
        max={s.total}
        label={`${s.covered} of ${s.total} questions answered`}
        tone={s.state === 'passed' ? 'success' : 'info'}
        className="max-w-sm"
      />
      {s.state === 'passed' && s.passed_by ? (
        <p className="text-sm text-fg-2">
          Passed by {whoOf(s.passed_by).kind === 'you' ? 'you' : whoName(whoOf(s.passed_by))}
          {s.passed_at ? (
            <>
              {' '}
              · <DayTime iso={s.passed_at} />
            </>
          ) : null}
        </p>
      ) : null}
      {s.state === 'not_started' ? (
        <p className="text-sm text-fg-2">
          {s.position === 0 ? 'It opens when you start the design stages.' : 'It opens when the stage before it passes.'}
        </p>
      ) : null}
      {s.exploration_id || canPass ? (
        <div className="flex flex-wrap items-center gap-2">
          {canPass ? (
            <Button
              size="sm"
              variant={missing === 0 ? 'primary' : 'secondary'}
              data-command="stage.pass"
              onClick={() => {
                command.reset();
                focus.capture();
                setConfirming(true);
              }}
            >
              Pass stage
            </Button>
          ) : null}
          {s.exploration_id ? (
            <Link
              to="/p/$projectId/threads/$explorationId"
              params={{ projectId, explorationId: s.exploration_id }}
              aria-label={`Open the thread of ${s.title}`}
              className={buttonClass({ size: 'sm', variant: canPass ? 'quiet' : 'secondary' })}
            >
              Open thread
            </Link>
          ) : null}
        </div>
      ) : null}
      {canPass && missing > 0 ? (
        <p className="flex items-start gap-1.5 text-sm text-fg-2" data-why-not>
          <InfoIcon size={14} className="mt-0.5 shrink-0 text-fg-3" />
          Not ready to pass: {missing} of {s.total} {s.total === 1 ? 'question still needs' : 'questions still need'} an answer.
        </p>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={(o) => {
          setConfirming(o);
          if (!o) focus.restore();
        }}
        title={`Pass ${s.title}?`}
        description={
          <>
            <p>A stage passes once its mandatory questions are covered. Passing it is your decision.</p>
            <p>{next ? `${next.title} opens next.` : 'It is the last stage.'}</p>
          </>
        }
        confirm="Pass stage"
        pendingLabel="Passing…"
        pending={command.isPending}
        error={confirming ? command.error : null}
        onConfirm={() =>
          s.id &&
          command.mutate(
            { command: 'stage.pass', entityId: s.id },
            {
              onSuccess: () => {
                setConfirming(false);
                announce(`${s.title} passed.${next ? ` ${next.title} is open.` : ''}`);
              },
            },
          )
        }
      />
    </div>
  );
}
