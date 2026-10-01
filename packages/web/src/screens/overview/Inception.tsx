// «Getting to the first build» on the Product page: the whole path from a new project to its first
// build as a numbered list, with the current step standing out and carrying its one action. The
// server computes the path (state.inception); an older server sends none and nothing shows.

import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { stateQuery } from '../../api/queries.ts';
import type { InceptionPath, InceptionStep } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { ArrowRightIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { Section } from '../../components/Page.tsx';
import { cn } from '../../lib/cn.ts';
import { messages, useContentMessages, useMessages } from '../../i18n/define.ts';
import { STAGES } from './words.i18n.ts';

export const INCEPTION = messages(
  {
    title: (done: number, total: number) => `Getting to the first build · ${done} of ${total}`,
    firstBuildDone: 'First build done',
    done: 'Done',
    now: 'Now',
    next: 'Later',
    notNeeded: 'Not needed',
    blocks: (what: string) => `Blocks: ${what}`,
    answer: 'Answer its questions',
    passStage: (title: string) => `Pass “${title}”`,
    startStage: (title: string) => `Start “${title}”`,
    starting: 'Starting…',
    startedAnnounce: (title: string) => `${title} started.`,
    open: (code: string) => `Open ${code}`,
    designSystem: 'Open the design system',
    epics: 'Open the epics',
    repository: 'Connect the repository',
    build: 'Go to Build',
    goToStages: 'Go to the stages',
    reviewDefinition: 'Review and approve the definition',
    planBacklog: 'Map the first version',
    reviewProposal: 'Review the proposal',
    decideProposals: (n: number) => `Decide ${n} proposals`,
    continueThread: 'Continue in its thread',
    proposingQuality: 'DEMIURGO is proposing the quality requirements…',
    planBacklogRequest:
      'Map the first version of the product definition as a story map (Jeff Patton, User Story Mapping): its capabilities in the order a person uses them, the thinnest end-to-end slice first (the walking skeleton), and for each capability whether it is one feature or an epic of several. Propose one thread per capability so I can design them one by one, and say where you would start.',
    nextUp: (title: string) => `Next: ${title}`,
  },
  {
    title: (done: number, total: number) => `Hasta la primera construcción · ${done} de ${total}`,
    firstBuildDone: 'Primera construcción hecha',
    done: 'Hecho',
    now: 'Ahora',
    next: 'Luego',
    notNeeded: 'No hace falta',
    blocks: (what: string) => `Bloquea: ${what}`,
    answer: 'Responder a sus preguntas',
    passStage: (title: string) => `Superar «${title}»`,
    startStage: (title: string) => `Empezar «${title}»`,
    starting: 'Empezando…',
    startedAnnounce: (title: string) => `${title} empezada.`,
    open: (code: string) => `Abrir ${code}`,
    designSystem: 'Abrir el sistema de diseño',
    epics: 'Abrir las épicas',
    repository: 'Conectar el repositorio',
    build: 'Ir a Construir',
    goToStages: 'Ir a las etapas',
    reviewDefinition: 'Revisar y aprobar la definición',
    planBacklog: 'Mapear la primera versión',
    reviewProposal: 'Revisar la propuesta',
    decideProposals: (n: number) => `Decidir ${n} propuestas`,
    continueThread: 'Seguir en su hilo',
    proposingQuality: 'DEMIURGO está proponiendo los requisitos de calidad…',
    planBacklogRequest:
      'Mapea la primera versión de la definición del producto como un mapa de historias (Jeff Patton, User Story Mapping): sus capacidades en el orden en que las usa una persona, primero la porción más fina de punta a punta (el walking skeleton), y para cada capacidad si es una funcionalidad o una épica de varias. Propón un hilo por capacidad para diseñarlas una a una, y dime por cuál empezarías.',
    nextUp: (title: string) => `Siguiente: ${title}`,
  },
);

const primary = buttonClass({ variant: 'primary' });

function PassStageButton({ projectId, step, action }: { projectId: string; step: InceptionStep; action: { stage: string; stageId: string } }) {
  const t = useMessages(INCEPTION);
  const s = useMessages(STAGES);
  const command = useCommand(projectId);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        variant="primary"
        data-command="stage.pass"
        onClick={() => {
          command.reset();
          setConfirming(true);
        }}
      >
        {t.passStage(step.title)}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={s.passStageOf(step.title)}
        description={<p>{s.passDescription1}</p>}
        confirm={s.passStage}
        pendingLabel={s.passing}
        pending={command.isPending}
        error={confirming ? command.error : null}
        onConfirm={() =>
          command.mutate(
            { command: 'stage.pass', entityId: action.stageId },
            {
              onSuccess: () => {
                setConfirming(false);
                announce(s.passedAnnounce(step.title, null));
              },
            },
          )
        }
      />
    </>
  );
}

/** Asks DEMIURGO for the story map in the main thread (resumed if closed) and goes there. */
function PlanBacklogButton({ projectId, thread }: { projectId: string; thread: string }) {
  const t = useMessages(INCEPTION);
  const request = useContentMessages(INCEPTION).planBacklogRequest;
  const command = useCommand(projectId);
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-2">
      {command.error ? <ErrorNotice error={command.error} /> : null}
      <div>
        <Button
          variant="primary"
          pending={command.isPending}
          onClick={async () => {
            try {
              await command.mutateAsync({ command: 'message.post', data: { exploration_id: thread, text: request, respond: true } });
              void navigate({ to: '/p/$projectId/threads/$explorationId', params: { projectId, explorationId: thread } });
            } catch {
              // The error shows above the button.
            }
          }}
        >
          {t.planBacklog}
        </Button>
      </div>
    </div>
  );
}

/** The one button of a step: a link to where it is done, or the command itself. */
export function InceptionActionButton({ projectId, step }: { projectId: string; step: InceptionStep }) {
  const t = useMessages(INCEPTION);
  const command = useCommand(projectId);
  const action = step.action;
  if (!action) return null;
  const link = (to: string, params: Record<string, string>, label: string) => (
    <Link to={to as never} params={params as never} className={primary}>
      {label}
      <ArrowRightIcon size={15} />
    </Link>
  );
  switch (action.kind) {
    case 'answer_stage':
      return action.thread ? (
        link('/p/$projectId/threads/$explorationId', { projectId, explorationId: action.thread }, t.answer)
      ) : (
        <a href="#design-stages" className={primary}>
          {t.goToStages}
        </a>
      );
    case 'pass_stage':
      return <PassStageButton projectId={projectId} step={step} action={action} />;
    case 'open_stage':
      return (
        <div className="flex flex-col gap-2">
          {command.error ? <ErrorNotice error={command.error} /> : null}
          <div>
            <Button
              variant="primary"
              data-command="stage.open"
              pending={command.isPending}
              pendingLabel={t.starting}
              onClick={() =>
                command.mutate(
                  { command: 'stage.open', data: { stage: action.stage } },
                  { onSuccess: () => announce(t.startedAnnounce(step.title)) },
                )
              }
            >
              {t.startStage(step.title)}
            </Button>
          </div>
        </div>
      );
    case 'approve':
    case 'feature':
      return link('/p/$projectId/records/$code', { projectId, code: action.code }, t.open(action.code));
    case 'design_system':
      return link('/p/$projectId/design-system', { projectId }, t.designSystem);
    case 'epics':
      return link('/p/$projectId/epics', { projectId }, t.epics);
    case 'repository':
      return link('/p/$projectId/repository', { projectId }, t.repository);
    case 'build':
      return link('/p/$projectId/build', { projectId }, action.code ? t.open(action.code) : t.build);
    case 'plan_backlog':
      return action.thread ? <PlanBacklogButton projectId={projectId} thread={action.thread} /> : link('/p/$projectId/epics', { projectId }, t.epics);
    case 'review_batch':
      return link('/p/$projectId/batches/$batchId', { projectId, batchId: action.batch }, action.count && action.count > 1 ? t.decideProposals(action.count) : t.reviewProposal);
    case 'thread':
      return link('/p/$projectId/threads/$explorationId', { projectId, explorationId: action.thread }, t.continueThread);
    case 'waiting':
      return (
        <p className="text-sm text-fg-2" role="status" data-inception-waiting={action.what}>
          {t.proposingQuality}
        </p>
      );
    case 'review_definition':
      return (
        <a href="#definition" className={primary}>
          {t.reviewDefinition}
          <ArrowRightIcon size={15} />
        </a>
      );
  }
}

function StepItem({ projectId, step, index }: { projectId: string; step: InceptionStep; index: number }) {
  const t = useMessages(INCEPTION);
  const word = { done: t.done, current: t.now, todo: t.next, skipped: t.notNeeded }[step.state];
  const current = step.state === 'current';
  return (
    <li
      data-inception-step={step.key}
      data-state={step.state}
      aria-current={current ? 'step' : undefined}
      className={cn('flex gap-3', current ? 'py-3' : 'py-1', current ? 'border-l-2 border-accent-edge bg-accent-soft px-3' : 'pl-3', step.state === 'skipped' && 'opacity-70')}
    >
      <span className="w-5 shrink-0 text-sm font-medium text-fg-2 tabular-nums">{index + 1}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className={cn('text-sm text-fg', current ? 'font-semibold' : 'font-medium')}>{step.title}</span>
          <span className={cn('text-xs', current ? 'font-medium text-accent-text' : 'text-fg-2')}>{word}</span>
        </p>
        {/* Only the current step explains itself: the rest is a title to keep the list scannable. */}
        {current ? (
          <>
            <p className="text-sm text-fg-2">{step.why}</p>
            {step.blocks ? <p className="text-xs text-fg-2">{t.blocks(step.blocks)}</p> : null}
            <p className="text-xs text-fg-3">{step.source}</p>
          </>
        ) : null}
        {current && step.action ? (
          <div className="self-start pt-1">
            <InceptionActionButton projectId={projectId} step={step} />
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function InceptionSection({ projectId, path }: { projectId: string; path: InceptionPath | undefined }) {
  const t = useMessages(INCEPTION);
  if (!path || path.steps.length === 0) return null;
  if (path.current === null) {
    return (
      <p className="text-sm text-fg-2" data-inception="done">
        {t.firstBuildDone}
      </p>
    );
  }
  return (
    <Section title={t.title(path.done, path.total)} id="inception">
      <ol className="flex flex-col" data-inception="path">
        {path.steps.map((step, i) => (
          <StepItem key={step.key} projectId={projectId} step={step} index={i} />
        ))}
      </ol>
    </Section>
  );
}

/** The step the person still has to take on the way to the first build, or null. */
export function useInceptionCurrent(projectId: string): InceptionStep | null {
  const path = useQuery(stateQuery(projectId)).data?.inception;
  if (!path || path.current === null) return null;
  return path.steps.find((s) => s.key === path.current) ?? null;
}

/** «Next: <step>» where the screen would say «You can close DEMIURGO», linking to the Product page. */
export function InceptionNext({ projectId, step, className }: { projectId: string; step: InceptionStep; className?: string }) {
  const t = useMessages(INCEPTION);
  return (
    <Link to="/p/$projectId" params={{ projectId }} className={cn('inline-flex items-center gap-1 font-medium text-accent-text hover:underline', className)} data-inception-next>
      {t.nextUp(step.title)} <ArrowRightIcon size={12} />
    </Link>
  );
}
