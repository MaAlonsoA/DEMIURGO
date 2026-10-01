// Words of the automatic build: builder agent, pull request, CI, reviewer agent and merge.

import { messages } from '../../i18n/define.ts';

export const AGENT_BUILD = messages(
  {
    build: 'Build with an agent',
    buildAgain: 'Build again',
    addressReview: 'Address the review',
    reviewConfirmTitle: (code: string) => `Address the review of ${code}?`,
    reviewConfirmText:
      "DEMIURGO's builder agent continues on the same branch and pull request, with the reviewer's comments as feedback. CI and the review run again and it merges only if CI is green and the review approves. It uses your subscription quota.",
    building: 'Starting…',
    needsYou: (n: number) => `DEMIURGO tried ${n} ${n === 1 ? 'time' : 'times'}; it needs you.`,
    confirmTitle: (code: string) => `Build ${code} with an agent?`,
    confirmText:
      "DEMIURGO's builder agent writes the code in an isolated container, opens a pull request on GitHub, CI runs, DEMIURGO's reviewer agent reviews it and it merges automatically only if CI is green and the review approves. It uses your subscription quota.",
    connect: 'Connect GitHub to let an agent build it',
    stages: 'Build stages',
    violations: (n: number) => `${n} ${n === 1 ? 'design-system violation' : 'design-system violations'}`,
    noDesign: 'No design system yet',
    proposeComponent: (name: string) => `Propose adding ${name} to the design system`,
    pullRequest: 'Pull request',
    verdictApprove: 'Approved',
    verdictChanges: 'Changes requested',
    comments: (n: number) => `${n} ${n === 1 ? 'comment' : 'comments'}`,
    failureReason: (kind: string | null | undefined, timedOutTwiceOn?: string | null): string => {
      switch (kind) {
        case 'usage_limit':
          return "Stopped: the subscription's usage limit was reached. Try again after it resets.";
        case 'login':
        case 'auth':
          return "Stopped: the engine's sign-in expired or is invalid. Run `claude setup-token` and set CLAUDE_CODE_OAUTH_TOKEN (or sign in again), then build again.";
        case 'timeout':
          return timedOutTwiceOn
            ? `The builder ran out of time twice; its work is on branch ${timedOutTwiceOn}. The task may be too big: consider splitting it.`
            : 'Stopped: the builder ran out of time and left nothing to continue from. The task may be too big: consider splitting it.';
        case 'out_of_memory':
          return 'Stopped: the builder ran out of memory and was killed.';
        case 'cancelled':
          return 'Stopped: the build was cancelled.';
        case 'infra':
          return 'Stopped: the builder container could not run (Docker problem).';
        case 'unreadable_files':
          return 'Stopped: the commit could not read some files the builder left behind (tool caches such as downloaded browsers). Build again to retry from the commit.';
        case 'stage':
          return 'Stopped: this step failed.';
        default:
          return 'Stopped: the builder exited with an error.';
      }
    },
    failureDetails: 'Details',
    o_ok: 'done',
    o_started: 'running',
    o_waiting: 'waiting',
    o_failed: 'failed',
    o_changes_requested: 'changes requested',
    o_cancelled: 'cancelled',
    s_repo: 'Repository',
    s_worktree: 'Workspace',
    s_environment: 'Environment',
    s_builder: 'Builder agent',
    s_commit: 'Commit',
    s_design: 'Design system',
    s_push: 'Push',
    s_pr: 'Pull request',
    s_status: 'Review status',
    s_ci: 'CI',
    s_evidence: 'Evidence',
    s_review: 'Reviewer agent',
    s_publish: 'Review published',
    s_merge: 'Merge',
    s_main: 'CI on main',
  },
  {
    build: 'Construir con un agente',
    buildAgain: 'Volver a construir',
    addressReview: 'Atender la revisión',
    reviewConfirmTitle: (code: string) => `¿Atender la revisión de ${code}?`,
    reviewConfirmText:
      'El agente constructor de DEMIURGO continúa en la misma rama y pull request, con los comentarios del revisor como indicaciones. Vuelven a pasar la CI y la revisión, y se fusiona solo si la CI está en verde y la revisión aprueba. Usa la cuota de tu suscripción.',
    building: 'Empezando…',
    needsYou: (n: number) => `DEMIURGO lo intentó ${n} ${n === 1 ? 'vez' : 'veces'}; te necesita.`,
    confirmTitle: (code: string) => `¿Construir ${code} con un agente?`,
    confirmText:
      'El agente constructor de DEMIURGO escribe el código en un contenedor aislado, abre una pull request en GitHub, pasa la CI, el agente revisor de DEMIURGO la revisa y se fusiona sola solo si la CI está en verde y la revisión aprueba. Usa la cuota de tu suscripción.',
    connect: 'Conecta GitHub para que lo construya un agente',
    stages: 'Etapas de la construcción',
    violations: (n: number) => `${n} ${n === 1 ? 'incumplimiento del sistema de diseño' : 'incumplimientos del sistema de diseño'}`,
    noDesign: 'Todavía no hay sistema de diseño',
    proposeComponent: (name: string) => `Proponer añadir ${name} al sistema de diseño`,
    pullRequest: 'Pull request',
    verdictApprove: 'Aprobada',
    verdictChanges: 'Cambios pedidos',
    comments: (n: number) => `${n} ${n === 1 ? 'comentario' : 'comentarios'}`,
    failureReason: (kind: string | null | undefined, timedOutTwiceOn?: string | null): string => {
      switch (kind) {
        case 'usage_limit':
          return 'Detenida: se alcanzó el límite de uso de la suscripción. Vuelve a intentarlo cuando se reinicie.';
        case 'login':
        case 'auth':
          return 'Detenida: el inicio de sesión del motor caducó o no es válido. Ejecuta `claude setup-token` y define CLAUDE_CODE_OAUTH_TOKEN (o inicia sesión de nuevo) y vuelve a construir.';
        case 'timeout':
          return timedOutTwiceOn
            ? `El constructor se quedó sin tiempo dos veces; su trabajo está en la rama ${timedOutTwiceOn}. Puede que la tarea sea demasiado grande: plantéate dividirla.`
            : 'Detenida: el constructor se quedó sin tiempo y no dejó nada desde lo que continuar. Puede que la tarea sea demasiado grande: plantéate dividirla.';
        case 'out_of_memory':
          return 'Detenida: el constructor se quedó sin memoria y se cortó.';
        case 'cancelled':
          return 'Detenida: la construcción se canceló.';
        case 'infra':
          return 'Detenida: el contenedor del constructor no pudo ejecutarse (problema de Docker).';
        case 'unreadable_files':
          return 'Detenida: el commit no pudo leer unos ficheros que dejó el constructor (cachés de herramientas, como navegadores descargados). Construye de nuevo para reintentar desde el commit.';
        case 'stage':
          return 'Detenida: este paso falló.';
        default:
          return 'Detenida: el constructor terminó con un error.';
      }
    },
    failureDetails: 'Detalles',
    o_ok: 'hecho',
    o_started: 'en curso',
    o_waiting: 'esperando',
    o_failed: 'falló',
    o_changes_requested: 'cambios pedidos',
    o_cancelled: 'cancelada',
    s_repo: 'Repositorio',
    s_worktree: 'Copia de trabajo',
    s_environment: 'Entorno',
    s_builder: 'Agente constructor',
    s_commit: 'Commit',
    s_design: 'Sistema de diseño',
    s_push: 'Push',
    s_pr: 'Pull request',
    s_status: 'Estado de revisión',
    s_ci: 'CI',
    s_evidence: 'Evidencia',
    s_review: 'Agente revisor',
    s_publish: 'Revisión publicada',
    s_merge: 'Fusión',
    s_main: 'CI en main',
  },
);
