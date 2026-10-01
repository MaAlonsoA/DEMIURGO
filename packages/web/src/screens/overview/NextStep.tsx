// "Next step" on the Product page (spec «Entrega por épicas», 2b): it replaces "Where do I start?"
// once there is an epic or a feature, and names the one thing to do now, with its action.

import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { ProductRow, ProductState, StageRow } from '../../api/types.ts';
import { buttonClass } from '../../components/Button.tsx';
import { Card } from '../../components/Card.tsx';
import { ArrowRightIcon } from '../../components/icons.tsx';
import { messages, useMessages } from '../../i18n/define.ts';
import { DesignNextButton } from '../epics/DesignNext.tsx';
import { useEpicPlans } from '../epics/plans.ts';
import { InceptionActionButton } from './Inception.tsx';
import { inceptionStep, type NextStep as Step, nextStep } from './nextStep.ts';

const WORDS = messages(
  {
    eyebrow: 'Next step',
    approveEpic: (code: string) => `Refine and approve ${code}`,
    approveEpicBody: (title: string) =>
      `Read "${title}": its goal, its features in order and when it is done. Approving it starts the design of its features, one at a time.`,
    build: (title: string) => `Build "${title}"`,
    buildBody: 'It is ready to build: on Build, an agent builds each task in its own pull request; CI records the evidence of each criterion and the reviewer checks it before merging.',
    passArchitecture: 'Pass the Architecture stage',
    passArchitectureBody: 'A feature is approved: before building it, settle the architecture in its stage.',
    closeGaps: (title: string) => `Close what "${title}" is missing`,
    closeGapsBody: (n: number) => `${n} ${n === 1 ? 'thing' : 'things'} left before it can be built.`,
    carryOn: (title: string) => `Carry on with "${title}"`,
    carryOnBody: 'It is being designed in its thread.',
    designNext: (name: string, code: string) => `Design "${name}" of ${code}`,
    checkWalk: (code: string) => `Check the walk-through of ${code}`,
    checkWalkBody: (title: string) => `Every feature of "${title}" is built: check its "Done when".`,
    release: 'First version: pass Security and Operations',
    releaseBody: 'Every epic is delivered. Before the first version, pass the Security and Operations stages.',
    open: (code: string) => `Open ${code}`,
    openThread: 'Open its thread',
    seeMissing: 'See what is missing',
    goToStages: 'Go to the stages',
    openChecks: 'Open its acceptance criteria',
  },
  {
    eyebrow: 'Siguiente paso',
    approveEpic: (code: string) => `Afina y aprueba ${code}`,
    approveEpicBody: (title: string) =>
      `Lee «${title}»: su objetivo, sus funcionalidades en orden y cuándo está terminada. Al aprobarla empieza el diseño de sus funcionalidades, de una en una.`,
    build: (title: string) => `Construir «${title}»`,
    buildBody: 'Está lista para construir: en Construir, un agente construye cada tarea en su propia pull request; la CI registra la evidencia de cada criterio y el revisor la comprueba antes de fusionar.',
    passArchitecture: 'Pasar la etapa Arquitectura',
    passArchitectureBody: 'Hay una funcionalidad aprobada: antes de construirla, cierra la arquitectura en su etapa.',
    closeGaps: (title: string) => `Cerrar lo que le falta a «${title}»`,
    closeGapsBody: (n: number) => `Le ${n === 1 ? 'falta 1 cosa' : `faltan ${n} cosas`} para poder construirla.`,
    carryOn: (title: string) => `Seguir con «${title}»`,
    carryOnBody: 'Se está diseñando en su hilo.',
    designNext: (name: string, code: string) => `Diseñar «${name}» de ${code}`,
    checkWalk: (code: string) => `Comprobar el recorrido de ${code}`,
    checkWalkBody: (title: string) => `Todas las funcionalidades de «${title}» están construidas: comprueba su «Terminada cuando».`,
    release: 'Primera versión: pasa Seguridad y Operación',
    releaseBody: 'Todas las épicas están entregadas. Antes de la primera versión, pasa las etapas de Seguridad y Operación.',
    open: (code: string) => `Abrir ${code}`,
    openThread: 'Abrir su hilo',
    seeMissing: 'Ver lo que falta',
    goToStages: 'Ir a las etapas',
    openChecks: 'Abrir sus criterios de aceptación',
  },
);

function StepCard({ step, title, body, action }: { step: Step['kind'] | 'inception'; title: string; body: ReactNode; action: ReactNode }) {
  const t = useMessages(WORDS);
  return (
    <Card tone="accent" data-next-step={step} className="flex flex-col gap-3">
      <p className="flex flex-col gap-1 text-base text-fg">
        <span className="text-xs font-medium uppercase tracking-wide text-accent-text">{t.eyebrow}</span>
        <span className="font-semibold">{title}</span>
        {body ? <span className="text-fg-2">{body}</span> : null}
      </p>
      <div className="self-start">{action}</div>
    </Card>
  );
}

const linkClass = buttonClass({ variant: 'primary' });

export function NextStepCard(props: { projectId: string; state: ProductState; rows: ProductRow[]; stages: StageRow[] }) {
  const inception = inceptionStep(props.state.inception);
  if (!inception) return <RecordsNextStep {...props} />;
  return (
    <StepCard
      step="inception"
      title={inception.title}
      body={inception.why}
      action={<InceptionActionButton projectId={props.projectId} step={inception} />}
    />
  );
}

function RecordsNextStep({
  projectId,
  state,
  rows,
  stages,
}: {
  projectId: string;
  state: ProductState;
  rows: ProductRow[];
  stages: StageRow[];
}) {
  const t = useMessages(WORDS);
  const epics = useEpicPlans(projectId, state);
  if (!epics) return null;
  const step = nextStep(rows, epics, stages);
  if (!step) return null;
  const toRecord = (code: string, label: string, tab?: string) => (
    <Link
      to="/p/$projectId/records/$code"
      params={{ projectId, code }}
      search={(tab ? { tab } : {}) as never}
      className={linkClass}
    >
      {label}
      <ArrowRightIcon size={15} />
    </Link>
  );
  const toThread = (threadId: string, label: string) => (
    <Link to="/p/$projectId/threads/$explorationId" params={{ projectId, explorationId: threadId }} className={linkClass}>
      {label}
      <ArrowRightIcon size={15} />
    </Link>
  );
  const toStages = (
    <a href="#design-stages" className={linkClass}>
      {t.goToStages}
    </a>
  );
  switch (step.kind) {
    case 'approve_epic':
      return (
        <StepCard
          step={step.kind}
          title={t.approveEpic(step.code)}
          body={t.approveEpicBody(step.title)}
          action={toRecord(step.code, t.open(step.code))}
        />
      );
    case 'build':
      return <StepCard step={step.kind} title={t.build(step.title)} body={t.buildBody} action={toRecord(step.code, t.open(step.code))} />;
    case 'pass_architecture':
      return (
        <StepCard
          step={step.kind}
          title={t.passArchitecture}
          body={t.passArchitectureBody}
          action={step.threadId ? toThread(step.threadId, t.openThread) : toStages}
        />
      );
    case 'close_gaps':
      return (
        <StepCard
          step={step.kind}
          title={t.closeGaps(step.title)}
          body={t.closeGapsBody(step.left)}
          action={toRecord(step.code, t.seeMissing)}
        />
      );
    case 'continue':
      return (
        <StepCard
          step={step.kind}
          title={t.carryOn(step.title)}
          body={t.carryOnBody}
          action={step.threadId ? toThread(step.threadId, t.openThread) : step.code ? toRecord(step.code, t.open(step.code)) : null}
        />
      );
    case 'design_next':
      return (
        <StepCard
          step={step.kind}
          title={t.designNext(step.line.name, step.epic.code)}
          body={step.line.phrase}
          action={<DesignNextButton projectId={projectId} epic={step.epic} line={step.line} named />}
        />
      );
    case 'check_walk':
      return (
        <StepCard
          step={step.kind}
          title={t.checkWalk(step.code)}
          body={t.checkWalkBody(step.title)}
          action={toRecord(step.code, t.openChecks, 'checks')}
        />
      );
    case 'release':
      return <StepCard step={step.kind} title={t.release} body={t.releaseBody} action={toStages} />;
  }
}
