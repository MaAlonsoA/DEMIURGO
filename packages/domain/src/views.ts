// Product views (FDR-INT-002): what the map and the journeys read from the records, purely and
// without inventing anything. The map's relations are the typed links; a journey's steps are the
// numbered points of an FDR's Behavior and its paths are its acceptance criteria.

/** What the map draws between two records. */
export type Relation = 'needs' | 'follows' | 'conflicts' | 'affects';

/**
 * The relation a link becomes: a feature based on another feature needs it; anything based on a
 * decision or a tech decision follows it (a rule); conflicts_with conflicts; derived_from affects.
 * Links that say where something comes from (origin) or what a check covers are not drawn.
 */
export function relationOf(linkType: string, fromType: string, toType: string): Relation | null {
  if (linkType === 'based_on' || linkType === 'design_of') return fromType === 'fdr' && toType === 'fdr' ? 'needs' : 'follows';
  if (linkType === 'conflicts_with') return 'conflicts';
  if (linkType === 'derived_from') return 'affects';
  return null;
}

export type JourneyStep = { n: number; title: string; detail: string[] };

const stripMarks = (t: string): string => t.replace(/\*\*(.+?)\*\*/g, '$1').trim();

/** «**Sesión.** Lo demás» → title «Sesión.» and the rest as the first detail line. */
function splitLead(text: string): { title: string; rest: string | null } {
  const m = /^\*\*(.+?)\*\*\s*(.*)$/.exec(text.trim());
  if (m) return { title: stripMarks(m[1] ?? ''), rest: m[2]?.trim() ? stripMarks(m[2]) : null };
  return { title: stripMarks(text), rest: null };
}

/**
 * The steps of a journey from an FDR's Behavior: each top-level numbered point, in order, with its
 * nested bullets as detail. Without numbered points, each top-level bullet or paragraph is a step.
 */
export function behaviorSteps(markdown: string): JourneyStep[] {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const numbered = lines.some((l) => /^\d+\.\s+\S/.test(l));
  const steps: JourneyStep[] = [];
  const start = (text: string) => {
    const { title, rest } = splitLead(text);
    steps.push({ n: steps.length + 1, title, detail: rest ? [rest] : [] });
  };
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) start(paragraph.join(' '));
    paragraph = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      if (!numbered) flush();
      continue;
    }
    const top = numbered ? /^\d+\.\s+(.*)$/.exec(line) : /^[-*]\s+(.*)$/.exec(line);
    if (top) {
      flush();
      start(top[1] ?? '');
      continue;
    }
    const nested = /^\s+(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    const last = steps.at(-1);
    if (nested && last) {
      last.detail.push(stripMarks(nested[1] ?? ''));
      continue;
    }
    if (numbered) {
      if (last) last.detail.push(stripMarks(line));
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return steps;
}

export type JourneyPath = { given: string | null; when: string | null; outcome: string };

const SHAPES = [
  /^(?:Dad[oa]s?)\s+(.+?),\s*cuando\s+(.+?),\s*entonces\s+(.+)$/is,
  /^Given\s+(.+?),\s*when\s+(.+?),\s*then\s+(.+)$/is,
];

/** A criterion «Dado…, cuando…, entonces…» (or Given/when/then) as a journey path. */
export function criterionPath(statement: string): JourneyPath {
  const text = statement.trim();
  for (const shape of SHAPES) {
    const m = shape.exec(text);
    if (m) return { given: m[1]?.trim() ?? null, when: m[2]?.trim() ?? null, outcome: m[3]?.trim() ?? text };
  }
  return { given: null, when: null, outcome: text };
}
