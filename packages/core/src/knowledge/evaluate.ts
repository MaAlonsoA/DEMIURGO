// Evaluación del clasificador con el conjunto propio (§7.9, AC-CON-001-11): precisión y
// cobertura por veredicto y por hallazgo, matriz de confusión y curva por umbral. El resultado
// se registra en un archivo y en la tabla classifier_evaluations.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type IdeaCase,
  type VerdictCase,
  type Classifier,
  IDEA_FINDINGS,
  type ItemChoice,
  type EvaluationResult,
  VERDICTS,
  loadJsonlCases,
  ideaCaseSchema,
  verdictCaseSchema,
  evaluateClassification,
  sha256,
} from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';

export type Partition = 'dev' | 'test' | 'all';

export type EvaluationReport = {
  classifier: string;
  date: string;
  dataset: string;
  /** Huella sha256 de cada fichero del conjunto: con qué versión exacta se midió. */
  fingerprints: { verdicts: string; ideas: string };
  partition: Partition;
  durationMs: number;
  verdicts: EvaluationResult<string>;
  ideas: EvaluationResult<string>;
  responses: { id: string; task: string; expected: string; actual: string; confidence: number; justification: string }[];
  file?: string;
};

const VERDICT_QUESTION =
  'Con este cambio aprobado, ¿qué le pasa al candidato: sigue igual, se relaciona, hay que actualizarlo, queda invalidado, hay que añadirle algo u otra cosa?';
const IDEA_QUESTION =
  '¿Qué relación tiene la idea con este conocimiento: la duplica, lo contradice, es incoherente, se relaciona o ninguna?';

function verdictItems(cases: readonly VerdictCase[]): ItemChoice[] {
  return cases.map((c) => ({
    id: c.id,
    state: { task: 'verdict', change: c.change, candidate: c.candidate },
    question: VERDICT_QUESTION,
    options: VERDICTS,
  }));
}

function ideaItems(cases: readonly IdeaCase[]): ItemChoice[] {
  return cases.map((c) => ({
    id: c.id,
    state: { task: 'idea', idea: c.idea, node: c.node },
    question: IDEA_QUESTION,
    options: IDEA_FINDINGS,
  }));
}

async function respondInChunks(classifier: Classifier, items: readonly ItemChoice[], chunkSize: number) {
  const responses = [];
  for (let i = 0; i < items.length; i += chunkSize) responses.push(...(await classifier.choice(items.slice(i, i + chunkSize))));
  return new Map(responses.map((r) => [r.id, r]));
}

export async function evaluateClassifier(options: {
  classifier: Classifier;
  dir?: string;
  partition?: Partition;
  /** Ítems por llamada al clasificador (la referencia por CLI agrupa cada tanda en una llamada). */
  chunkSize?: number;
  db?: Db;
  output?: string;
}): Promise<EvaluationReport> {
  const dir = options.dir ?? 'evals/classifier/v1';
  const partition = options.partition ?? 'test';
  const filter = <T extends { partition: string }>(cases: T[]) =>
    partition === 'all' ? cases : cases.filter((c) => c.partition === partition);
  const verdictsText = await readFile(join(dir, 'verdicts.jsonl'), 'utf8');
  const ideasText = await readFile(join(dir, 'ideas.jsonl'), 'utf8');
  const fingerprints = { verdicts: sha256(verdictsText), ideas: sha256(ideasText) };
  const verdicts = filter(loadJsonlCases(verdictsText, verdictCaseSchema));
  const ideas = filter(loadJsonlCases(ideasText, ideaCaseSchema));
  const start = Date.now();
  const chunkSize = options.chunkSize ?? 50;
  const revision = await respondInChunks(options.classifier, verdictItems(verdicts), chunkSize);
  const ri = await respondInChunks(options.classifier, ideaItems(ideas), chunkSize);
  const durationMs = Date.now() - start;
  const responses: EvaluationReport['responses'] = [];
  const cases = <C extends string>(
    list: readonly { id: string; expected: C }[],
    map: Map<string, { choice: string; confidence: number; justification: string }>,
    task: string,
    classes: readonly C[],
  ) =>
    list.map((c) => {
      const r = map.get(c.id);
      // Una respuesta que falta o fuera de las clases cuenta como fallo (se registra como «other»/«none»).
      const actual = (r && (classes as readonly string[]).includes(r.choice) ? r.choice : classes[classes.length - 1]) as C;
      responses.push({
        id: c.id,
        task,
        expected: c.expected,
        actual,
        confidence: r?.confidence ?? 0,
        justification: r?.justification ?? 'sin respuesta',
      });
      return { expected: c.expected, actual, confidence: r?.confidence ?? 0 };
    });
  const report: EvaluationReport = {
    classifier: options.classifier.id,
    date: new Date().toISOString(),
    dataset: dir,
    fingerprints,
    partition,
    durationMs,
    verdicts: evaluateClassification({ classes: VERDICTS, cases: cases(verdicts, revision, 'verdict', VERDICTS) }),
    ideas: evaluateClassification({ classes: IDEA_FINDINGS, cases: cases(ideas, ri, 'idea', IDEA_FINDINGS) }),
    responses,
  };
  if (options.output) {
    await mkdir(options.output, { recursive: true });
    const name = `${options.classifier.id.replace(/[^a-z0-9-]+/gi, '_')}-${partition}-${report.date.slice(0, 19).replace(/[:T]/g, '-')}.json`;
    report.file = join(options.output, name).split('\\').join('/');
    await writeFile(report.file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  if (options.db) {
    for (const [task, metrics] of [
      ['verdicts', report.verdicts],
      ['ideas', report.ideas],
    ] as const) {
      await options.db
        .insertInto('classifier_evaluations')
        .values({
          classifier: report.classifier,
          dataset: `${dir}@sha256:${fingerprints[task]}`,
          partition: partition,
          task: task,
          metrics: JSON.stringify(metrics),
          file: report.file ?? null,
        })
        .execute();
    }
  }
  return report;
}

function table(title: string, r: EvaluationResult<string>): string {
  return [
    `${title}: exactitud ${(r.accuracy * 100).toFixed(1)} % (${r.hits}/${r.total})`,
    ...Object.entries(r.byClass).map(
      ([c, m]) =>
        `  ${c.padEnd(12)} precisión ${(m.precision * 100).toFixed(0).padStart(3)} %  cobertura ${(m.recall * 100).toFixed(0).padStart(3)} %  (${m.hits}/${m.support})`,
    ),
  ].join('\n');
}

/** Resumen legible: precisión y cobertura por clase. */
export function evaluationSummary(i: EvaluationReport): string {
  return `${i.classifier} · ${i.partition} · ${i.durationMs} ms\n${table('Verdicts', i.verdicts)}\n${table('Ideas', i.ideas)}`;
}
