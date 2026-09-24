// Classifier evaluation with its own dataset (§7.9, AC-CON-001-11): precision and
// recall by verdict and by finding, confusion matrix and threshold curve. The result
// is recorded in a file and in the classifier_evaluations table.

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
  /** sha256 fingerprint of each dataset file: which exact version was measured. */
  fingerprints: { verdicts: string; ideas: string };
  partition: Partition;
  durationMs: number;
  verdicts: EvaluationResult<string>;
  ideas: EvaluationResult<string>;
  responses: { id: string; task: string; expected: string; actual: string; confidence: number; justification: string }[];
  file?: string;
};

const VERDICT_QUESTION =
  'With this change approved, what happens to the candidate: does it stay the same, relate to it, need updating, become invalid, need something added, or something else?';
const IDEA_QUESTION =
  'How does the idea relate to this knowledge: does it duplicate it, conflict with it, is it inconsistent, does it relate, or none of these?';

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
  /** Items per classifier call (the CLI reference classifier groups each batch into one call). */
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
  const verdictResponses = await respondInChunks(options.classifier, verdictItems(verdicts), chunkSize);
  const ideaResponses = await respondInChunks(options.classifier, ideaItems(ideas), chunkSize);
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
      // A missing response, or one outside the classes, counts as a miss (recorded as "other"/"none").
      const actual = (r && (classes as readonly string[]).includes(r.choice) ? r.choice : classes[classes.length - 1]) as C;
      responses.push({
        id: c.id,
        task,
        expected: c.expected,
        actual,
        confidence: r?.confidence ?? 0,
        justification: r?.justification ?? 'no response',
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
    verdicts: evaluateClassification({ classes: VERDICTS, cases: cases(verdicts, verdictResponses, 'verdict', VERDICTS) }),
    ideas: evaluateClassification({ classes: IDEA_FINDINGS, cases: cases(ideas, ideaResponses, 'idea', IDEA_FINDINGS) }),
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
    `${title}: accuracy ${(r.accuracy * 100).toFixed(1)} % (${r.hits}/${r.total})`,
    ...Object.entries(r.byClass).map(
      ([c, m]) =>
        `  ${c.padEnd(12)} precision ${(m.precision * 100).toFixed(0).padStart(3)} %  recall ${(m.recall * 100).toFixed(0).padStart(3)} %  (${m.hits}/${m.support})`,
    ),
  ].join('\n');
}

/** Human-readable summary: precision and recall by class. */
export function evaluationSummary(i: EvaluationReport): string {
  return `${i.classifier} · ${i.partition} · ${i.durationMs} ms\n${table('Verdicts', i.verdicts)}\n${table('Ideas', i.ideas)}`;
}
