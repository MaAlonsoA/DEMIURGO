// Checks that the classifier's evaluation set (evals/classifier/v1) meets its format
// and the README's split rules: minimum support per class, stratified partitions and
// consistent nodes between cases. Each test collects the problems in a list so the failure says which ones.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IDEA_FINDINGS, VERDICTS } from '../src/classifier.ts';
import {
  type IdeaCase,
  type VerdictCase,
  loadJsonlCases,
  ideaCaseSchema,
  verdictCaseSchema,
  EVAL_PARTITIONS,
} from '../src/metrics.ts';

const DIR = new URL('../../../evals/classifier/v1/', import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, DIR), 'utf8');

const verdicts: VerdictCase[] = loadJsonlCases(read('verdicts.jsonl'), verdictCaseSchema);
const ideas: IdeaCase[] = loadJsonlCases(read('ideas.jsonl'), ideaCaseSchema);

type Artifact = { ref: string; type: string; title: string; text: string };
type Case = { id: string; partition: string; expected: string; labels?: readonly string[] | undefined };

/** The code's prefix fixes the artifact's type. */
const TYPE_BY_PREFIX: Readonly<Record<string, string>> = {
  DEC: 'decision',
  FDR: 'fdr',
  ADR: 'adr',
  AC: 'criterion',
  IDEA: 'idea',
  FUE: 'source',
};

function count(cases: readonly Case[], kind: string, partition?: string): number {
  return cases.filter((c) => c.expected === kind && (partition === undefined || c.partition === partition)).length;
}

function duplicates(values: readonly string[]): string[] {
  return values.filter((v, i) => values.indexOf(v) !== i);
}

/** Minimum support, every class in each partition, and a stratified split (difference ≤ 1). */
function splitProblems(cases: readonly Case[], classes: readonly string[], minimum: (kind: string) => number): string[] {
  const problems: string[] = [];
  for (const kind of classes) {
    const total = count(cases, kind);
    if (total < minimum(kind)) problems.push(`${kind}: support ${total} < ${minimum(kind)}`);
    const [dev = 0, test = 0] = EVAL_PARTITIONS.map((p) => count(cases, kind, p));
    if (dev === 0 || test === 0) problems.push(`${kind}: missing from some partition (${dev}/${test})`);
    if (Math.abs(dev - test) > 1) problems.push(`${kind}: split not stratified (${dev}/${test})`);
  }
  return problems;
}

describe('classifier evaluation set v1', () => {
  it('verdicts.jsonl: format, unique ids, minimum support per class and stratified partitions', () => {
    expect(verdicts.length).toBeGreaterThanOrEqual(60);
    expect(duplicates(verdicts.map((c) => c.id))).toEqual([]);
    expect(splitProblems(verdicts, VERDICTS, (v) => (v === 'other' ? 4 : 6))).toEqual([]);
    expect(verdicts.filter((c) => c.change.ref === c.candidate.ref).map((c) => c.id)).toEqual([]);
    expect(duplicates(verdicts.map((c) => `${c.change.ref} → ${c.candidate.ref}`))).toEqual([]);
  });

  it('ideas.jsonl: format, unique ids, minimum support per class and stratified partitions', () => {
    expect(ideas.length).toBeGreaterThanOrEqual(40);
    expect(duplicates(ideas.map((c) => c.id))).toEqual([]);
    expect(splitProblems(ideas, IDEA_FINDINGS, () => 6)).toEqual([]);
    expect(duplicates(ideas.map((c) => `${c.idea.text} → ${c.node.ref}`))).toEqual([]);
  });

  it('each ref@version has a single type, title and text across both files, and the type matches its prefix', () => {
    const artifacts: Artifact[] = [...verdicts.flatMap((c) => [c.change, c.candidate]), ...ideas.map((c) => c.node)];
    const seen = new Map<string, Artifact>();
    const problems: string[] = [];
    for (const a of artifacts) {
      const type = TYPE_BY_PREFIX[a.ref.split('-')[0] ?? ''];
      if (a.type !== type) problems.push(`${a.ref}: type ${a.type}, its prefix calls for ${type ?? '(unknown)'}`);
      const existing = seen.get(a.ref);
      if (!existing) seen.set(a.ref, a);
      else if (existing.type !== a.type || existing.title !== a.title || existing.text !== a.text) {
        problems.push(`${a.ref}: appears with different contents`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('includes cases with injected instructions in both partitions', () => {
    const problems: string[] = [];
    for (const [name, cases] of [
      ['verdicts', verdicts],
      ['ideas', ideas],
    ] as const) {
      const injected = (cases as readonly Case[]).filter((c) => c.labels?.includes('injection'));
      for (const p of EVAL_PARTITIONS) {
        if (!injected.some((c) => c.partition === p)) problems.push(`${name}: no injection in ${p}`);
      }
    }
    const injectedVerdicts = verdicts.filter((c) => c.labels?.includes('injection'));
    expect(injectedVerdicts.length).toBeGreaterThanOrEqual(4);
    for (const c of injectedVerdicts) {
      // The instruction is in the change's or candidate's text and asks for a verdict other than the correct one.
      const request = /responde\s+(?:siempre\s+)?«?([a-z]+)»?/i.exec(`${c.change.text} ${c.candidate.text}`)?.[1];
      if (request === undefined) problems.push(`${c.id}: does not contain the injected instruction`);
      else if (request === c.expected) problems.push(`${c.id}: the instruction asks for the correct verdict (${request})`);
    }
    expect(problems).toEqual([]);
  });
});
