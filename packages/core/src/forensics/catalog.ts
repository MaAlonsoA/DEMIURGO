// The piece catalog of the task forensics: the inventory of EVERY piece of DEMIURGO that can act on a task, so
// the forensic agent answers a checklist (one entry per piece) and nothing is left out. It is built from the code
// itself, never from a hand-kept list that can drift: the agent and skill folders, the harness piece names, the
// bus guards registry, the build orchestrator's stages, the queue decision kinds, Jev's question modules, the
// context-pack builders, the readiness function and the escape rules. A piece that exists and the catalog misses
// fails `forensics-catalog.test.ts`. The checklist idea is the one of an After Action Review that walks every
// element of the plan (US Army, TC 25-20) and of a postmortem that does not stop at the first cause (Google SRE
// book, ch. 15); the use as a completeness gate is our convention.

import { readFile, readdir } from 'node:fs/promises';
import { TRANSITIONS, fingerprint } from '@demiurgo/domain';
import { loadAgentCatalog } from '../agents/catalog.ts';
import { PIECE_NAMES } from '../harness/pieces.ts';

export type PieceKind = 'agent' | 'skill' | 'piece' | 'guard' | 'stage' | 'queue' | 'jev' | 'context' | 'readiness' | 'escape';

export type CatalogItem = {
  /** `agent:task_planner`, `skill:writing-acs`, `guard:test_guard`, `jev:testability`, `stage:environment`, `queue:wait_testability`, `piece:B07`, `escape:E15`… */
  id: string;
  kind: PieceKind;
  name: string;
  /** A content hash or the piece's own version mark: what was in force when the catalog was built. */
  version: string;
  /** The design phases it acts in (P1…P13); empty when it acts in any. */
  phases: string[];
  what_it_does: string;
};

const SRC = new URL('../', import.meta.url);
const short = (value: unknown): string => fingerprint(value).slice(0, 12);

/** First sentence-sized line of a file's leading `//` comment, without the marker. */
function headerOf(source: string, max = 280): string {
  const lines: string[] = [];
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('//')) {
      if (lines.length > 0 || line !== '') break;
      continue;
    }
    lines.push(line.replace(/^\/\/+\s?/, ''));
  }
  const text = lines.join(' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const readSource = (path: string): Promise<string> => readFile(new URL(path, SRC), 'utf8');

/** The design phase of the agents' actions (our convention: the phases of the path of the design doc §2.2). */
const ACTION_PHASES: Readonly<Record<string, string[]>> = {
  exploration_chat: ['P1', 'P2', 'P3'],
  design_proposal: ['P3'],
  coherence_review: ['P5'],
  epic_plan: ['P5'],
  feature_design: ['P5'],
  task_plan: ['P7'],
  design_directions: ['P4'],
  design_system_plan: ['P4'],
  screen_design: ['P6'],
  pr_review: ['P10'],
  task_build: ['P9'],
  task_forensics: [],
  playbook_write: [],
  known_error_curate: [],
};

const DESIGN_PHASES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];

/** What each build stage does, in a line. A stage the map does not know keeps a generic line, and still counts. */
const STAGE_TEXT: Readonly<Record<string, string>> = {
  repo: 'Makes sure the project repository exists and is connected.',
  worktree: 'Prepares the isolated git worktree of the attempt.',
  environment: 'Starts the isolated environment (dependencies, database, services) the builder works in.',
  builder: 'The builder agent edits the code in its container; its report and failure class are stored here.',
  commit: 'Commits what the builder changed and records the files it changed on its own.',
  design: 'DEMIURGO guards on the commit before the push: ownership, design system, duplicate tests, TDD.',
  push: 'Pushes the branch.',
  pr: 'Opens or updates the pull request.',
  status: 'Publishes the pending required statuses on the pull request.',
  evidence: 'Reads the CI results (JUnit) and records the evidence of each criterion.',
  ci: 'Waits for CI, in parallel with the review, and records its conclusion and failures.',
  review: 'The reviewer agent judges the pull request; its verdict becomes the required status.',
  publish: 'Publishes the review verdict and the evidence statuses to GitHub.',
  merge: 'Arms and watches the merge gate: CI green, review approved, branch up to date.',
  main: 'Watches CI on main after the merge.',
  withdraw: 'The person withdrew the build request.',
};

const QUEUE_TEXT: Readonly<Record<string, string>> = {
  wait_dependency: 'The queue holds the task because a task it depends on is not merged yet.',
  wait_feature_busy: 'The queue holds the task because another task of the same feature is building.',
  wait_schema: 'The queue holds the task because another task changing the schema is building.',
  wait_module: 'The queue holds the task because it shares a hotspot, table, route or page with a task that is building.',
  wait_testability: 'The queue holds the task because a criterion it covers cannot be checked automatically as written.',
  wait_hold: 'The queue holds the task because a person put it on hold.',
  stopped: 'The queue stopped (needs you, ended, stale, manual review, waiting, main red).',
  over_limit: 'The task is ready but the parallel limit of the queue was reached.',
};

/** The classifier files that put a question to Jev, and the ones that are plumbing around it. */
export const JEV_QUESTION_FILES = [
  'aspect',
  'code-rerank',
  'fix-check',
  'layers',
  'review-findings',
  'review-triage',
  'session-signals',
  'size',
  'task-needs',
  'test-reuse',
  'testability',
] as const;
export const CLASSIFIER_PLUMBING_FILES = [
  'agent-classifier',
  'calls',
  'cascade',
  'index',
  'jev',
  'question-version',
  'repo-context',
  'simulated',
  'task-input',
  'testability-policy',
] as const;

async function agentItems(): Promise<CatalogItem[]> {
  const catalog = await loadAgentCatalog();
  const used = new Map<string, Set<string>>();
  for (const a of catalog.agents) for (const s of a.skills) used.set(s, new Set([...(used.get(s) ?? []), ...(ACTION_PHASES[a.action] ?? [])]));
  return [
    ...catalog.agents.map((a) => ({
      id: `agent:${a.id}`,
      kind: 'agent' as const,
      name: a.id,
      version: a.version,
      phases: ACTION_PHASES[a.action] ?? [],
      what_it_does: a.description,
    })),
    ...catalog.skills.map((s) => ({
      id: `skill:${s.id}`,
      kind: 'skill' as const,
      name: s.id,
      version: short({ description: s.description, body: s.body }),
      phases: [...(used.get(s.id) ?? [])].toSorted(),
      what_it_does: s.description,
    })),
  ];
}

function pieceItems(): CatalogItem[] {
  return Object.entries(PIECE_NAMES).map(([code, name]) => ({
    id: `piece:${code}`,
    kind: 'piece' as const,
    name: `${code} · ${name}`,
    version: short(name),
    phases: code.startsWith('B') ? (code === 'B17' ? ['P10'] : ['P9']) : DESIGN_PHASES,
    what_it_does: name,
  }));
}

async function guardItems(): Promise<CatalogItem[]> {
  await import('../commands/index.ts');
  const { GUARDS } = await import('../bus/guards.ts');
  const commandsOf = new Map<string, Set<string>>();
  for (const entity of Object.values(TRANSITIONS.entities) as unknown as { transitions: { command: string; guards?: string[] }[] }[])
    for (const t of entity.transitions) for (const g of t.guards ?? []) commandsOf.set(g, new Set([...(commandsOf.get(g) ?? []), t.command]));
  return Object.entries(GUARDS).map(([name, fn]) => ({
    id: `guard:${name}`,
    kind: 'guard' as const,
    name,
    version: short(fn.toString()),
    phases: [],
    what_it_does: `Bus guard \`${name}\`: refuses (409) the commands ${[...(commandsOf.get(name) ?? [])].toSorted().join(', ') || '(none declared)'} unless its condition holds.`,
  }));
}

async function stageItems(): Promise<CatalogItem[]> {
  const source = await readSource('build/orchestrator.ts');
  const names = new Set<string>();
  for (const m of source.matchAll(/\b(?:stage|record)\(r, '([a-z_]+)'/g)) names.add(m[1] ?? '');
  // `main` and `withdraw` are recorded outside the orchestrator's flow function but are stages of the build steps.
  for (const known of ['main', 'withdraw']) if (source.includes(`'${known}'`)) names.add(known);
  return [...names].filter(Boolean).toSorted().map((name) => ({
    id: `stage:${name}`,
    kind: 'stage' as const,
    name,
    version: short(STAGE_TEXT[name] ?? name),
    phases: name === 'review' || name === 'publish' ? ['P10'] : ['P9'],
    what_it_does: STAGE_TEXT[name] ?? `Build stage \`${name}\` of the orchestrator.`,
  }));
}

/** The kinds of decision the queue records, read from the migration that constrains `queue_decisions.decision`. */
async function queueDecisionKinds(): Promise<string[]> {
  const dir = new URL('../../migrations/', import.meta.url);
  let kinds: string[] = [];
  for (const f of (await readdir(dir)).filter((n) => n.endsWith('.sql')).toSorted()) {
    const sql = await readFile(new URL(f, dir), 'utf8');
    const m = /queue_decisions[\s\S]*?decision\s+text\s+not\s+null\s+check\s*\(\s*decision\s+in\s*\(([^)]*)\)/.exec(sql);
    if (m) kinds = [...(m[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1] ?? '');
  }
  return kinds;
}

async function queueItems(): Promise<CatalogItem[]> {
  return (await queueDecisionKinds())
    .filter((k) => k !== 'start' && k !== 'running')
    .map((k) => ({
      id: `queue:${k}`,
      kind: 'queue' as const,
      name: k,
      version: short(QUEUE_TEXT[k] ?? k),
      phases: ['P9'],
      what_it_does: QUEUE_TEXT[k] ?? `Queue decision \`${k}\`.`,
    }));
}

async function jevItems(): Promise<CatalogItem[]> {
  const out: CatalogItem[] = [];
  for (const file of JEV_QUESTION_FILES) {
    const source = await readSource(`classifier/${file}.ts`);
    const mod = (await import(`../classifier/${file}.ts`)) as Record<string, unknown>;
    const versions = Object.entries(mod)
      .filter(([k, v]) => k.endsWith('QUESTION_VERSION') && typeof v === 'string')
      .map(([, v]) => String(v))
      .toSorted();
    out.push({
      id: `jev:${file.replaceAll('-', '_')}`,
      kind: 'jev',
      name: `Jev · ${file.replaceAll('-', ' ')}`,
      version: versions.length > 0 ? versions.join('+') : short(source),
      phases: file === 'review-triage' || file === 'fix-check' || file === 'review-findings' ? ['P10'] : file === 'aspect' ? DESIGN_PHASES : ['P7', 'P9'],
      what_it_does: headerOf(source),
    });
  }
  return out;
}

async function contextItems(): Promise<CatalogItem[]> {
  await import('../actions/index.ts');
  const { BUILDERS } = await import('../context/build.ts');
  return Object.entries(BUILDERS)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([action, fn]) => ({
      id: `context:${action}`,
      kind: 'context' as const,
      name: `Context pack of ${action}`,
      version: short(fn?.toString() ?? action),
      phases: ACTION_PHASES[action] ?? [],
      what_it_does: `Builds, deterministically, what the \`${action}\` agent reads (its context pack and manifest).`,
    }));
}

async function readinessItems(): Promise<CatalogItem[]> {
  const { readiness } = await import('@demiurgo/domain');
  return [
    {
      id: 'readiness:ready_to_build',
      kind: 'readiness',
      name: 'Readiness («ready to build»)',
      version: short(readiness.toString()),
      phases: ['P5', 'P7'],
      what_it_does: 'Says what a record still misses before it can be approved or built, in the words of the Build page.',
    },
  ];
}

async function escapeItems(): Promise<CatalogItem[]> {
  const { ESCAPE_RULES, ESCAPES_RULES_VERSION } = await import('../harness/rules/escapes/index.ts');
  const out: CatalogItem[] = [];
  for (const code of Object.keys(ESCAPE_RULES).toSorted()) {
    const header = headerOf(await readSource(`harness/rules/escapes/${code.toLowerCase()}.ts`));
    out.push({ id: `escape:${code}`, kind: 'escape', name: code, version: ESCAPES_RULES_VERSION, phases: [], what_it_does: header });
  }
  return out;
}

/** Every piece of DEMIURGO as a checklist item, sorted by id. Built from the code: nothing here is kept by hand. */
export async function loadPieceCatalog(): Promise<CatalogItem[]> {
  const items = [
    ...(await agentItems()),
    ...pieceItems(),
    ...(await guardItems()),
    ...(await stageItems()),
    ...(await queueItems()),
    ...(await jevItems()),
    ...(await contextItems()),
    ...(await readinessItems()),
    ...(await escapeItems()),
  ];
  const seen = new Set<string>();
  for (const i of items) {
    if (seen.has(i.id)) throw new Error(`The piece catalog has "${i.id}" twice.`);
    seen.add(i.id);
  }
  return items.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The version of the checklist's shape: a hash of its ids. A change to a piece's own version does not change it (the
 * checklist is the same), a piece added or removed does: forensics of different checklists are never mixed.
 */
export function catalogVersion(items: readonly CatalogItem[]): string {
  return short(items.map((i) => i.id).toSorted());
}

/** The versions in force by id, kept with each forensic so a verdict says which version of the piece it judged. */
export function catalogMarks(items: readonly CatalogItem[]): Record<string, string> {
  return Object.fromEntries(items.map((i) => [i.id, i.version]));
}
