// Which engine runs each agent (FDR-AGE-002), chosen by a person from what discovery found, for
// every project: one engine per group of agents (Deep thinking, Quick…) and, as an exception, an
// agent's own. Append-only: every change is a row with who and when, and the current choice is the
// latest (a row without provider removes it). Resolution goes Retry with… → the agent's own → its
// group's. The only switch is the one the person set up: a backup engine per group or agent
// (engine_fallbacks), which runs when the chosen one isn't available or can't be reached, and the
// run says so. Retry with… never falls back. Project assignments (older rows of agent_assignments)
// are kept but no longer read.

import { type Actor, DomainError, type FailureKind, formatActor } from '@demiurgo/domain';
import { sql } from 'kysely';
import { loadAgentCatalog } from '../agents/catalog.ts';
import type { Db, Tx } from '../db/connection.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import { type SettingsDeps, catalogOf, requireSetting } from './catalogs.ts';

export type Engine = { provider: string; model: string; effort: string | null };
/** What an engine choice is for: a whole group, or one agent as an exception to its group. */
export type AssignmentTarget = { agent: string } | { group: string };
export type AssignmentInput = AssignmentTarget & Engine;
/** Where the engine of a run came from: Retry with…, the agent's own engine, its group's, or the backup. */
export type AssignmentSource = 'override' | 'agent' | 'group' | 'fallback';

/** The backup engine of an agent (its own, else its group's) and why it can't run now, if it can't. */
export type Fallback = Engine & { source: 'agent' | 'group'; problem: string | null };
/** The engine a backup ran instead of, and why. */
export type Replaced = Engine & { reason: string };

export type Resolution =
  | ({ status: 'ok'; source: AssignmentSource; fallback: Fallback | null; replaced?: Replaced } & Engine)
  | { status: 'unassigned' }
  | ({ status: 'unavailable'; source: AssignmentSource; reason: string; fallback: Fallback | null } & Engine);

export type CurrentAssignment = { engine: Engine; assignedBy: string; assignedAt: string };

/** The current choices by id: each agent's own engine and each group's. Removed ones don't appear. */
export type CurrentAssignments = {
  agents: Record<string, CurrentAssignment>;
  groups: Record<string, CurrentAssignment>;
};

function labelOf(providers: ProviderRegistry, id: string): string {
  return providers.get(id)?.label ?? (id ? `${id[0]?.toUpperCase()}${id.slice(1)}` : id);
}

/** Why an engine can't run now, or null if it can: provider here, discovered, model and effort offered. */
async function engineProblem(db: Db | Tx, providers: ProviderRegistry, e: Engine): Promise<string | null> {
  const label = labelOf(providers, e.provider);
  if (!providers.get(e.provider)) return `${label} isn't available here.`;
  const catalog = await catalogOf(db, e.provider);
  if (!catalog) return `${label} hasn't been discovered yet: press Refresh in Models & providers.`;
  const model = catalog.models.find((m) => m.id === e.model);
  if (!model) return `${e.model} is no longer offered by ${label}.`;
  if (model.efforts.length === 0 ? e.effort !== null : e.effort === null || !model.efforts.includes(e.effort)) {
    return `${e.effort ?? 'No effort'} is not an effort of ${e.model}.`;
  }
  return null;
}

/** Checks an engine against the latest catalog before assigning it: a 422 that lists what there is. */
async function validateEngine(db: Db | Tx, providers: ProviderRegistry, e: Engine): Promise<void> {
  const label = labelOf(providers, e.provider);
  if (!providers.get(e.provider)) {
    throw new DomainError('validation', `${label} isn't available here.`, [
      `Providers here: ${
        providers
          .list()
          .map((p) => p.id)
          .join(', ') || 'none'
      }.`,
    ]);
  }
  const catalog = await catalogOf(db, e.provider);
  const model = catalog?.models.find((m) => m.id === e.model);
  if (!catalog || !model) {
    throw new DomainError('validation', `${e.model} isn't offered by ${label}.`, [
      `${label} offers: ${catalog?.models.map((m) => m.id).join(', ') || 'nothing yet (press Refresh)'}.`,
    ]);
  }
  if (model.efforts.length === 0) {
    if (e.effort !== null) throw new DomainError('validation', `${e.model} has no effort levels.`, ['Leave the effort empty.']);
    return;
  }
  if (e.effort === null || !model.efforts.includes(e.effort)) {
    throw new DomainError('validation', `${e.effort ?? 'An empty effort'} is not an effort of ${e.model}.`, [
      `Efforts of ${e.model}: ${model.efforts.join(', ')}.`,
    ]);
  }
}

async function validateTarget(t: AssignmentTarget): Promise<void> {
  const catalog = await loadAgentCatalog();
  if ('group' in t) {
    if (!catalog.groups.some((g) => g.id === t.group)) {
      throw new DomainError('validation', `There is no group "${t.group}".`, [
        `Groups: ${catalog.groups.map((g) => g.id).join(', ') || 'none'}.`,
      ]);
    }
    return;
  }
  if (!catalog.get(t.agent)) {
    throw new DomainError('validation', `There is no agent "${t.agent}".`, [
      `Agents: ${catalog.agents.map((a) => a.id).join(', ')}.`,
    ]);
  }
}

/** One more row for a group or an agent; a null engine removes the choice. */
export async function insertChoice(db: Db | Tx, target: AssignmentTarget, engine: Engine | null, by: string): Promise<void> {
  const e = { provider: engine?.provider ?? null, model: engine?.model ?? null, effort: engine?.effort ?? null };
  if ('group' in target) {
    await db
      .insertInto('group_assignments')
      .values({ group_id: target.group, ...e, assigned_by: by })
      .execute();
    return;
  }
  await db
    .insertInto('agent_assignments')
    .values({ scope: 'global', project_id: null, agent: target.agent, ...e, assigned_by: by })
    .execute();
}

/** A person assigns a provider, model and effort to a group, or to one agent as an exception. */
export async function assignAgent(deps: SettingsDeps, actor: Actor, input: AssignmentInput): Promise<void> {
  requireSetting('agent.assign', actor);
  await validateTarget(input);
  const engine = { provider: input.provider, model: input.model, effort: input.effort };
  await validateEngine(deps.db, deps.providers, engine);
  await insertChoice(deps.db, input, engine, formatActor(actor));
}

/** A person removes a choice: an agent then follows its group again; a group is left without engine. */
export async function unassignAgent(deps: SettingsDeps, actor: Actor, target: AssignmentTarget): Promise<void> {
  requireSetting('agent.unassign', actor);
  await validateTarget(target);
  await insertChoice(deps.db, target, null, formatActor(actor));
}

/** One more backup row for a group or an agent; a null engine removes the backup. */
export async function insertFallback(db: Db | Tx, target: AssignmentTarget, engine: Engine | null, by: string): Promise<void> {
  const e = { provider: engine?.provider ?? null, model: engine?.model ?? null, effort: engine?.effort ?? null };
  await db
    .insertInto('engine_fallbacks')
    .values({
      agent: 'agent' in target ? target.agent : null,
      group_id: 'group' in target ? target.group : null,
      ...e,
      assigned_by: by,
    })
    .execute();
}

/** A person sets the backup engine of a group, or of one agent as an exception. */
export async function setFallback(deps: SettingsDeps, actor: Actor, input: AssignmentInput): Promise<void> {
  requireSetting('agent.set_fallback', actor);
  await validateTarget(input);
  const engine = { provider: input.provider, model: input.model, effort: input.effort };
  await validateEngine(deps.db, deps.providers, engine);
  await insertFallback(deps.db, input, engine, formatActor(actor));
}

/** A person removes a backup: an agent then takes its group's backup, if it has one. */
export async function removeFallback(deps: SettingsDeps, actor: Actor, target: AssignmentTarget): Promise<void> {
  requireSetting('agent.remove_fallback', actor);
  await validateTarget(target);
  await insertFallback(deps.db, target, null, formatActor(actor));
}

type ChoiceRow = {
  key: string;
  provider: string | null;
  model: string | null;
  effort: string | null;
  assigned_by: string;
  assigned_at: Date;
};

function byKey(rows: readonly ChoiceRow[]): Record<string, CurrentAssignment> {
  const out: Record<string, CurrentAssignment> = {};
  for (const r of rows) {
    if (r.provider === null) continue;
    out[r.key] = {
      engine: { provider: r.provider, model: r.model ?? '', effort: r.effort },
      assignedBy: r.assigned_by,
      assignedAt: new Date(r.assigned_at).toISOString(),
    };
  }
  return out;
}

/** The current choices: each agent's own engine (everywhere) and each group's. */
export async function currentAssignments(db: Db | Tx): Promise<CurrentAssignments> {
  const agents = await sql<ChoiceRow>`
    select distinct on (agent) agent as key, provider, model, effort, assigned_by, assigned_at
    from agent_assignments
    where scope = 'global'
    order by agent, assigned_at desc, id desc`.execute(db);
  const groups = await sql<ChoiceRow>`
    select distinct on (group_id) group_id as key, provider, model, effort, assigned_by, assigned_at
    from group_assignments
    order by group_id, assigned_at desc, id desc`.execute(db);
  return { agents: byKey(agents.rows), groups: byKey(groups.rows) };
}

/** The current backups: each agent's own and each group's. Removed ones don't appear. */
export async function currentFallbacks(db: Db | Tx): Promise<CurrentAssignments> {
  const rows = await sql<ChoiceRow & { agent: string | null }>`
    select distinct on (agent, group_id) coalesce(agent, group_id) as key, agent, provider, model, effort, assigned_by, assigned_at
    from engine_fallbacks
    order by agent, group_id, assigned_at desc, id desc`.execute(db);
  return {
    agents: byKey(rows.rows.filter((r) => r.agent !== null)),
    groups: byKey(rows.rows.filter((r) => r.agent === null)),
  };
}

/** The backup engine of an agent: its own, else its group's; null when it has none. */
export async function fallbackOf(db: Db | Tx, providers: ProviderRegistry, agent: string): Promise<Fallback | null> {
  const current = await currentFallbacks(db);
  const group = (await loadAgentCatalog()).get(agent)?.group;
  const own = current.agents[agent];
  const shared = group ? current.groups[group] : undefined;
  const chosen = own
    ? { source: 'agent' as const, ...own.engine }
    : shared
      ? { source: 'group' as const, ...shared.engine }
      : null;
  return chosen ? { ...chosen, problem: await engineProblem(db, providers, chosen) } : null;
}

export const sameEngine = (a: Engine, b: Engine): boolean =>
  a.provider === b.provider && a.model === b.model && a.effort === b.effort;

/**
 * The engine a run of this agent uses: Retry with… → its own → its group's; its backup when that one
 * isn't available, saying which one it replaces and why. Retry with… has no backup.
 */
export async function resolveEngine(
  db: Db | Tx,
  providers: ProviderRegistry,
  p: { agent: string; override?: Engine },
): Promise<Resolution> {
  let chosen: { source: AssignmentSource; engine: Engine } | null = null;
  if (p.override) chosen = { source: 'override', engine: p.override };
  else {
    const current = await currentAssignments(db);
    const own = current.agents[p.agent];
    const group = (await loadAgentCatalog()).get(p.agent)?.group;
    const shared = group ? current.groups[group] : undefined;
    if (own) chosen = { source: 'agent', engine: own.engine };
    else if (shared) chosen = { source: 'group', engine: shared.engine };
  }
  if (!chosen) return { status: 'unassigned' };
  const fallback = p.override ? null : await fallbackOf(db, providers, p.agent);
  const usable = fallback && !fallback.problem && !sameEngine(fallback, chosen.engine) ? fallback : null;
  const problem = await engineProblem(db, providers, chosen.engine);
  if (!problem) return { status: 'ok', source: chosen.source, ...chosen.engine, fallback: usable };
  if (usable) {
    const { provider, model, effort } = usable;
    return {
      status: 'ok',
      source: 'fallback',
      provider,
      model,
      effort,
      fallback: null,
      replaced: { ...chosen.engine, reason: problem },
    };
  }
  return { status: 'unavailable', source: chosen.source, reason: problem, ...chosen.engine, fallback };
}

/**
 * The failures that mean the engine couldn't answer at all: its provider couldn't be reached, didn't
 * answer in time, or refused because a usage, rate or quota limit was hit.
 */
const UNREACHABLE: readonly FailureKind[] = ['infra', 'timeout', 'quota'];

/** Whether a call failed because its engine couldn't answer at all (not a wrong answer, not a cancel). */
export function couldNotAnswer(result: { state: string; failureKind?: FailureKind }): boolean {
  return result.state !== 'ok' && !!result.failureKind && UNREACHABLE.includes(result.failureKind);
}

/**
 * The backup to call after a call on the resolved engine failed because it couldn't answer, or null:
 * a wrong answer, a cancelled run or an engine already running as the backup don't fall back.
 */
export function fallbackAfter(r: Resolution, result: { state: string; failureKind?: FailureKind }): Fallback | null {
  return r.status === 'ok' && couldNotAnswer(result) ? r.fallback : null;
}

/** What the person has to do so the agent can run, or null if it can. */
export function resolutionProblem(agent: string, r: Resolution): string | null {
  if (r.status === 'ok') return null;
  if (r.status === 'unassigned') return `Choose a model for ${agent} in Models & providers.`;
  const backup = r.fallback?.problem ? ` Its backup can't run either: ${r.fallback.problem}` : '';
  return `${r.reason}${backup} Choose another model for ${agent}.`;
}
