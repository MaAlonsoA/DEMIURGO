// Clasificador simulado determinista (AC-CLA-001-02): reglas léxicas sobre el estado de cada
// ítem. Es la línea base de las pruebas y de la evaluación; no pretende ser bueno, sino
// reproducible. Cada ítem declara su tarea en `estado.tarea`.

import {
  type Classifier,
  type ItemChoice,
  type ItemNoul,
  type ItemScore,
  type ChoiceResponse,
  verifiabilityWarnings,
  withoutAccents,
  similarity,
  overlap,
} from '@demiurgo/domain';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null ? (v as Obj) : {});
const txt = (v: unknown): string => (typeof v === 'string' ? v : '');
const textOf = (n: Obj): string => `${txt(n.title)}. ${txt(n.text)}`;

const SUPERSEDES =
  /\b(sustitu\w*|reemplaz\w*|deja(n)? obsolet\w*|anula\w*|revoca\w*|en lugar de|ya no|deja(n)? de|elimina\w*|suprim\w*|desaparece\w*)\b/;
const DENIES = /\b(no|nunca|sin|ningun\w*|prohib\w*|impide\w*)\b/;
const ADDS = /\b(anad\w*|nuev[oa]s?|ademas|tambien|incluye\w*|amplia\w*|agrega\w*)\b/;

function normalize(t: string): string {
  return withoutAccents(t.toLowerCase());
}

function choose(item: ItemChoice, choice: string, confidence: number, justification: string): ChoiceResponse {
  let final = choice;
  if (!item.options.includes(choice)) final = item.options.includes('other') ? 'other' : (item.options[0] ?? choice);
  const rest = (1 - confidence) / Math.max(1, item.options.length - 1);
  const distribution = Object.fromEntries(item.options.map((o) => [o, o === final ? confidence : rest]));
  return { id: item.id, choice: final, distribution, confidence, justification };
}

function verdict(item: ItemChoice): ChoiceResponse {
  const e = obj(item.state);
  const change = obj(e.change);
  const candidate = obj(e.candidate);
  const changeText = normalize(textOf(change));
  const sim = similarity(textOf(change), textOf(candidate));
  const refCand = txt(candidate.ref).split('@')[0] ?? '';
  const candidateCited = refCand !== '' && changeText.includes(normalize(refCand));
  if (candidateCited && SUPERSEDES.test(changeText))
    return choose(item, 'invalidate', 0.9, `El cambio sustituye explícitamente a ${refCand}.`);
  if (sim >= 0.3 && SUPERSEDES.test(changeText)) return choose(item, 'invalidate', 0.7, 'Mismo tema y el cambio sustituye lo anterior.');
  if (sim >= 0.3 && DENIES.test(changeText) !== DENIES.test(normalize(textOf(candidate)))) {
    return choose(item, 'update', 0.6, 'Mismo tema con una condición distinta.');
  }
  if (sim >= 0.2 && ADDS.test(changeText)) return choose(item, 'add', 0.6, 'El cambio añade algo al mismo tema.');
  if (sim >= 0.2 || candidateCited) return choose(item, 'relate', 0.8, 'Comparten tema.');
  if (sim >= 0.1) return choose(item, 'relate', 0.6, 'Relación débil por vocabulario compartido.');
  return choose(item, 'keep', 0.85, 'Sin relación apreciable.');
}

function ideaFinding(item: ItemChoice): ChoiceResponse {
  const e = obj(item.state);
  const idea = txt(obj(e.idea).text);
  const node = textOf(obj(e.node));
  const sim = similarity(idea, node);
  const recall = Math.min(overlap(idea, node), overlap(node, idea));
  if (sim >= 0.45 || recall >= 0.6) return choose(item, 'duplicates', 0.85, 'La idea dice lo mismo que el nodo.');
  const ideaDenies = DENIES.test(normalize(idea));
  const nodeDenies = DENIES.test(normalize(node));
  if (sim >= 0.2 && ideaDenies !== nodeDenies) return choose(item, 'conflicts', 0.65, 'Mismo tema con sentido contrario.');
  if (sim >= 0.12) return choose(item, 'relates', 0.7, 'Comparten tema.');
  return choose(item, 'none', 0.8, 'Sin relación apreciable.');
}

function category(item: ItemChoice): ChoiceResponse {
  const e = obj(item.state);
  const artifact = textOf(obj(e.artifact));
  const categories = Array.isArray(e.categories) ? e.categories.map(obj) : [];
  let best = { code: 'other', value: 0 };
  for (const c of categories) {
    const code = txt(c.code);
    if (code === 'other') continue;
    const value = overlap(`${txt(c.name)} ${txt(c.description)} ${code}`, artifact);
    if (value > best.value) best = { code, value };
  }
  if (best.value === 0) return choose(item, 'other', 0.5, 'Ninguna categoría encaja.');
  const confidence = Math.min(0.95, 0.55 + best.value);
  return choose(item, best.code, confidence, `Coincide con la descripción de «${best.code}».`);
}

export function createSimulatedClassifier(): Classifier {
  return {
    id: 'simulado@1',
    async choice(items) {
      return items.map((item) => {
        const task = obj(item.state).task;
        if (task === 'verdict') return verdict(item);
        if (task === 'idea') return ideaFinding(item);
        if (task === 'category') return category(item);
        return choose(item, item.options[0] ?? 'other', 0.3, 'Tarea desconocida para el simulador.');
      });
    },
    async score(items: readonly ItemScore[]) {
      return items.map((item) => {
        const e = obj(item.state);
        const sim = similarity(txt(e.queryName), txt(e.text));
        const levels = item.levels.length;
        const level = Math.min(levels - 1, Math.floor(sim * levels * 2));
        const distribution = item.levels.map((_, i) => (i === level ? 0.7 : 0.3 / Math.max(1, levels - 1)));
        return { id: item.id, level, distribution, confidence: 0.7 };
      });
    },
    async noul(items: readonly ItemNoul[]) {
      return items.map((item) => {
        const warnings = verifiabilityWarnings('AC', txt(obj(item.state).text));
        return { id: item.id, probability: warnings.length === 0 ? 0.85 : 0.25, confidence: 0.7 };
      });
    },
  };
}
