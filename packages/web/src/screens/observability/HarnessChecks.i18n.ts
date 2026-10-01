// Words of the «Checks» section (HarnessChecks.tsx).

import { messages } from '../../i18n/define.ts';

export const HARNESS_CHECKS = messages(
  {
    title: 'Checks',
    note: (total: number) =>
      `A deterministic check recomputes the pieces over the last 7 days, once a day or every 5 merged tasks, and compares with the previous one (${total} so far). A regression opens one issue in Needs you. The thresholds (a worse verdict, a containment drop over 0.2, a cost per merged task up more than 25 %) are our convention.`,
    loading: 'Loading the checks',
    empty: 'No check yet. The first one runs after the first post-mortem, or with pnpm cli harness check.',
    downloadJson: 'Download check JSON',
    latest: 'Latest check',
    trigger: (k: string) => ({ schedule: 'Daily', merges: 'After 5 merged tasks', manual: 'Manual' } as Record<string, string>)[k] ?? k,
    window: 'Window',
    regressionsTitle: 'Regressions',
    noRegressions: 'No regressions against the previous check.',
    regressionsCaption: 'Regressions of the latest check',
    colKind: 'What got worse',
    colSubject: 'Where',
    colBefore: 'Before',
    colAfter: 'After',
    kind: (k: string) =>
      ({ verdict_worse: 'Verdict', containment_drop: 'Containment', cost_per_task_up: 'Cost per merged task' } as Record<string, string>)[k] ?? k,
    newEscapesTitle: 'New escapes',
    newEscapes: (n: number) => (n === 0 ? 'No new escapes since the previous check.' : `${n} new ${n === 1 ? 'escape' : 'escapes'} since the previous check.`),
    seeEscapes: 'See the escapes',
    seriesTitle: 'Earlier checks',
    seriesCaption: 'Series of checks',
    colWhen: 'When',
    colTrigger: 'Trigger',
    colRegressions: 'Regressions',
    colNewEscapes: 'New escapes',
  },
  {
    title: 'Chequeos',
    note: (total: number) =>
      `Un chequeo determinista recalcula las piezas sobre los últimos 7 días, una vez al día o cada 5 tareas fusionadas, y compara con el anterior (${total} hasta ahora). Una regresión abre una incidencia en Necesita de ti. Los umbrales (un veredicto peor, una caída de contención de más de 0,2, un coste por tarea fusionada que sube más del 25 %) son convención nuestra.`,
    loading: 'Cargando los chequeos',
    empty: 'Aún no hay ningún chequeo. El primero corre tras el primer post-mortem, o con pnpm cli harness check.',
    downloadJson: 'Descargar el JSON del chequeo',
    latest: 'Último chequeo',
    trigger: (k: string) => ({ schedule: 'Diario', merges: 'Tras 5 tareas fusionadas', manual: 'Manual' } as Record<string, string>)[k] ?? k,
    window: 'Ventana',
    regressionsTitle: 'Regresiones',
    noRegressions: 'Sin regresiones respecto al chequeo anterior.',
    regressionsCaption: 'Regresiones del último chequeo',
    colKind: 'Qué empeoró',
    colSubject: 'Dónde',
    colBefore: 'Antes',
    colAfter: 'Después',
    kind: (k: string) =>
      ({ verdict_worse: 'Veredicto', containment_drop: 'Contención', cost_per_task_up: 'Coste por tarea fusionada' } as Record<string, string>)[k] ?? k,
    newEscapesTitle: 'Fugas nuevas',
    newEscapes: (n: number) => (n === 0 ? 'Ninguna fuga nueva desde el chequeo anterior.' : `${n} ${n === 1 ? 'fuga nueva' : 'fugas nuevas'} desde el chequeo anterior.`),
    seeEscapes: 'Ver las fugas',
    seriesTitle: 'Chequeos anteriores',
    seriesCaption: 'Serie de chequeos',
    colWhen: 'Cuándo',
    colTrigger: 'Disparador',
    colRegressions: 'Regresiones',
    colNewEscapes: 'Fugas nuevas',
  },
);
