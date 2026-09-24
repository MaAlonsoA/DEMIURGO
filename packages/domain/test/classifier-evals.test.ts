// Comprueba que el conjunto de evaluación del clasificador (evals/clasificador/v1) cumple su formato
// y las reglas de reparto del README: soporte mínimo por clase, particiones estratificadas y nodos
// coherentes entre casos. Cada prueba reúne los problemas en una lista para que el fallo diga cuáles son.

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

/** El prefijo del código fija el tipo del artefacto. */
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

/** Soporte mínimo, todas las clases en cada partición y reparto estratificado (diferencia ≤ 1). */
function splitProblems(cases: readonly Case[], classes: readonly string[], minimum: (kind: string) => number): string[] {
  const problems: string[] = [];
  for (const kind of classes) {
    const total = count(cases, kind);
    if (total < minimum(kind)) problems.push(`${kind}: soporte ${total} < ${minimum(kind)}`);
    const [dev = 0, test = 0] = EVAL_PARTITIONS.map((p) => count(cases, kind, p));
    if (dev === 0 || test === 0) problems.push(`${kind}: falta en alguna partición (${dev}/${test})`);
    if (Math.abs(dev - test) > 1) problems.push(`${kind}: reparto no estratificado (${dev}/${test})`);
  }
  return problems;
}

describe('conjunto de evaluación del clasificador v1', () => {
  it('veredictos.jsonl: formato, ids únicos, soporte mínimo por clase y particiones estratificadas', () => {
    expect(verdicts.length).toBeGreaterThanOrEqual(60);
    expect(duplicates(verdicts.map((c) => c.id))).toEqual([]);
    expect(splitProblems(verdicts, VERDICTS, (v) => (v === 'other' ? 4 : 6))).toEqual([]);
    expect(verdicts.filter((c) => c.change.ref === c.candidate.ref).map((c) => c.id)).toEqual([]);
    expect(duplicates(verdicts.map((c) => `${c.change.ref} → ${c.candidate.ref}`))).toEqual([]);
  });

  it('ideas.jsonl: formato, ids únicos, soporte mínimo por clase y particiones estratificadas', () => {
    expect(ideas.length).toBeGreaterThanOrEqual(40);
    expect(duplicates(ideas.map((c) => c.id))).toEqual([]);
    expect(splitProblems(ideas, IDEA_FINDINGS, () => 6)).toEqual([]);
    expect(duplicates(ideas.map((c) => `${c.idea.text} → ${c.node.ref}`))).toEqual([]);
  });

  it('cada ref@versión tiene un solo tipo, título y texto en los dos ficheros, y el tipo casa con su prefijo', () => {
    const artifacts: Artifact[] = [...verdicts.flatMap((c) => [c.change, c.candidate]), ...ideas.map((c) => c.node)];
    const seen = new Map<string, Artifact>();
    const problems: string[] = [];
    for (const a of artifacts) {
      const type = TYPE_BY_PREFIX[a.ref.split('-')[0] ?? ''];
      if (a.type !== type) problems.push(`${a.ref}: tipo ${a.type}, su prefijo pide ${type ?? '(desconocido)'}`);
      const existing = seen.get(a.ref);
      if (!existing) seen.set(a.ref, a);
      else if (existing.type !== a.type || existing.title !== a.title || existing.text !== a.text) {
        problems.push(`${a.ref}: aparece con contenidos distintos`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('incluye casos con instrucciones inyectadas en las dos particiones', () => {
    const problems: string[] = [];
    for (const [name, cases] of [
      ['verdicts', verdicts],
      ['ideas', ideas],
    ] as const) {
      const injected = (cases as readonly Case[]).filter((c) => c.labels?.includes('injection'));
      for (const p of EVAL_PARTITIONS) {
        if (!injected.some((c) => c.partition === p)) problems.push(`${name}: sin inyección en ${p}`);
      }
    }
    const injectedVerdicts = verdicts.filter((c) => c.labels?.includes('injection'));
    expect(injectedVerdicts.length).toBeGreaterThanOrEqual(4);
    for (const c of injectedVerdicts) {
      // La instrucción está en el texto del cambio o del candidato y pide un veredicto distinto del correcto.
      const request = /responde\s+(?:siempre\s+)?«?([a-z]+)»?/i.exec(`${c.change.text} ${c.candidate.text}`)?.[1];
      if (request === undefined) problems.push(`${c.id}: no contiene la instrucción inyectada`);
      else if (request === c.expected) problems.push(`${c.id}: la instrucción pide el veredicto correcto (${request})`);
    }
    expect(problems).toEqual([]);
  });
});
