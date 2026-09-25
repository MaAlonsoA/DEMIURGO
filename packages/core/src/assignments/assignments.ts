// Which engine runs each agent (FDR-AGE-002): a global assignment and a per-project override, chosen
// by a person from what discovery found. Append-only: every change is a row with who and when, and
// the current assignment is the latest (a row without provider removes it). Resolution goes
// override → project → global, and DEMIURGO never switches provider or model on its own.

import { type Actor, DomainError, formatActor } from '@demiurgo/domain';
import { sql } from 'kysely';
import { loadAgentCatalog } from '../agents/catalog.ts';
import type { Db, Tx } from '../db/connection.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import { type SettingsDeps, catalogOf, requireSetting } from './catalogs.ts';

export type Engine = { provider: string; model: string; effort: string | null };
export type AssignmentScope = 'global' | 'project';
export type AssignmentTarget = { agent: string; scope: AssignmentScope; projectId?: string };
export type AssignmentInput = AssignmentTarget & Engine;

export type Resolution =
  | ({ status: 'ok'; source: 'override' | 'project' | 'global' } & Engine)
  | { status: 'unassigned' }
  | ({ status: 'unavailable'; source: 'override' | 'project' | 'global'; reason: string } & Engine);

export type CurrentAssignment = {
  agent: string;
  scope: AssignmentScope;
  projectId: string | null;
  engine: Engine;
  assignedBy: string;
  assignedAt: string;
};

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function validateTarget(db: Db | Tx, t: AssignmentTarget): Promise<string | null> {
  const catalog = await loadAgentCatalog();
  if (!catalog.get(t.agent)) {
    throw new DomainError('validation', `There is no agent "${t.agent}".`, [
      `Agents: ${catalog.agents.map((a) => a.id).join(', ')}.`,
    ]);
  }
  if (t.scope === 'global') {
    if (t.projectId !== undefined) throw new DomainError('validation', 'A global assignment has no project.');
    return null;
  }
  if (!t.projectId) throw new DomainError('validation', 'A project assignment needs its project.');
  if (!RE_UUID.test(t.projectId)) throw new DomainError('not_found', 'The project does not exist.');
  const project = await db.selectFrom('projects').select('id').where('id', '=', t.projectId).executeTakeFirst();
  if (!project) throw new DomainError('not_found', 'The project does not exist.');
  return t.projectId;
}

/** A person assigns a provider, model and effort to an agent, globally or for a project. */
export async function assignAgent(deps: SettingsDeps, actor: Actor, input: AssignmentInput): Promise<void> {
  requireSetting('agent.assign', actor);
  const projectId = await validateTarget(deps.db, input);
  const engine = { provider: input.provider, model: input.model, effort: input.effort };
  await validateEngine(deps.db, deps.providers, engine);
  await deps.db
    .insertInto('agent_assignments')
    .values({ scope: input.scope, project_id: projectId, agent: input.agent, ...engine, assigned_by: formatActor(actor) })
    .execute();
}

/** A person removes an agent's assignment (a project one falls back to the global one). */
export async function unassignAgent(deps: SettingsDeps, actor: Actor, target: AssignmentTarget): Promise<void> {
  requireSetting('agent.unassign', actor);
  const projectId = await validateTarget(deps.db, target);
  await deps.db
    .insertInto('agent_assignments')
    .values({
      scope: target.scope,
      project_id: projectId,
      agent: target.agent,
      provider: null,
      model: null,
      effort: null,
      assigned_by: formatActor(actor),
    })
    .execute();
}

type AssignmentRow = {
  agent: string;
  scope: AssignmentScope;
  project_id: string | null;
  provider: string | null;
  model: string | null;
  effort: string | null;
  assigned_by: string;
  assigned_at: Date;
};

/** Current assignments: the global ones and, with a project, its overrides. Removed ones don't appear. */
export async function currentAssignments(db: Db | Tx, projectId?: string): Promise<CurrentAssignment[]> {
  const { rows } = await sql<AssignmentRow>`
    select * from (
      select distinct on (scope, coalesce(project_id::text, ''), agent)
        agent, scope, project_id, provider, model, effort, assigned_by, assigned_at
      from agent_assignments
      where scope = 'global' or project_id = ${projectId ?? null}::uuid
      order by scope, coalesce(project_id::text, ''), agent, assigned_at desc, id desc
    ) latest
    where provider is not null
    order by agent, scope`.execute(db);
  return rows.map((r) => ({
    agent: r.agent,
    scope: r.scope,
    projectId: r.project_id,
    engine: { provider: r.provider ?? '', model: r.model ?? '', effort: r.effort },
    assignedBy: r.assigned_by,
    assignedAt: new Date(r.assigned_at).toISOString(),
  }));
}

/** The engine a run of this agent uses: override → project → global. Never a silent fallback. */
export async function resolveEngine(
  db: Db | Tx,
  providers: ProviderRegistry,
  /** Without a project, only the global assignment counts (the workspace's Models & providers). */
  p: { projectId?: string; agent: string; override?: Engine },
): Promise<Resolution> {
  let chosen: { source: 'override' | 'project' | 'global'; engine: Engine } | null = null;
  if (p.override) chosen = { source: 'override', engine: p.override };
  else {
    const current = (await currentAssignments(db, p.projectId)).filter((a) => a.agent === p.agent);
    const own = current.find((a) => a.scope === 'project') ?? current.find((a) => a.scope === 'global');
    if (own) chosen = { source: own.scope, engine: own.engine };
  }
  if (!chosen) return { status: 'unassigned' };
  const problem = await engineProblem(db, providers, chosen.engine);
  return problem
    ? { status: 'unavailable', source: chosen.source, reason: problem, ...chosen.engine }
    : { status: 'ok', source: chosen.source, ...chosen.engine };
}

/** What the person has to do so the agent can run, or null if it can. */
export function resolutionProblem(agent: string, r: Resolution): string | null {
  if (r.status === 'ok') return null;
  if (r.status === 'unassigned') return `Choose a model for ${agent} in Models & providers.`;
  return `${r.reason} Choose another model for ${agent}.`;
}
