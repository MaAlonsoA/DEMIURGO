// Default engines (V2.2): the person's chosen configuration, seeded at startup. Each group of agents
// without any row yet gets its engine: taken from what its agents already run on (the most common
// engine among them, so a workspace from before the groups keeps working the same), or else the
// default below. The agents whose own engine matches their group's then follow the group; the ones
// that differ stay as exceptions. What the person assigns in Models & providers always wins: a
// group or an agent with any row, even a removal, is left alone.

import { formatActor, system } from '@demiurgo/domain';
import { loadAgentCatalog } from '../agents/catalog.ts';
import type { Db } from '../db/connection.ts';
import { type Engine, currentAssignments, insertChoice } from './assignments.ts';

export const DEFAULT_GROUP_ENGINES: Readonly<Record<string, Engine>> = {
  deep: { provider: 'codex', model: 'gpt-6-astra', effort: 'medium' },
  quick: { provider: 'codex', model: 'gpt-6-luna', effort: 'low' },
};

/** Agents that run on their own engine by default, not their group's (echo has no group). */
export const DEFAULT_AGENT_ENGINES: Readonly<Record<string, Engine>> = {
  designer: { provider: 'claude', model: 'opus', effort: 'high' },
  echo: { provider: 'opencode', model: 'qwen-local/qwen3.8-27b', effort: 'high' },
};

const sameEngine = (a: Engine, b: Engine) => a.provider === b.provider && a.model === b.model && a.effort === b.effort;

/** The engine most of these run on (the first one seen on a tie), or null if none has one. */
export function mostCommonEngine(engines: readonly Engine[]): Engine | null {
  let best: { engine: Engine; n: number } | null = null;
  for (const engine of engines) {
    const n = engines.filter((e) => sameEngine(e, engine)).length;
    if (!best || n > best.n) best = { engine, n };
  }
  return best?.engine ?? null;
}

/** Seeds the groups and agents that have no choice yet. Returns what it seeded («group:deep», «designer»…). */
export async function seedDefaultEngines(db: Db): Promise<string[]> {
  const by = formatActor(system('defaults'));
  const catalog = await loadAgentCatalog();
  const seeded: string[] = [];
  const touchedGroups = new Set(
    (await db.selectFrom('group_assignments').select('group_id').distinct().execute()).map((r) => r.group_id),
  );
  const current = await currentAssignments(db);
  for (const group of catalog.groups) {
    if (touchedGroups.has(group.id)) continue;
    const members = catalog.agents.filter((a) => a.group === group.id);
    const own = members.flatMap((a) => {
      const c = current.agents[a.id];
      return c ? [{ agent: a.id, engine: c.engine }] : [];
    });
    const engine = mostCommonEngine(own.map((o) => o.engine)) ?? DEFAULT_GROUP_ENGINES[group.id];
    if (!engine) continue;
    await insertChoice(db, { group: group.id }, engine, by);
    for (const o of own) if (sameEngine(o.engine, engine)) await insertChoice(db, { agent: o.agent }, null, by);
    seeded.push(`group:${group.id}`);
  }
  const touchedAgents = new Set(
    (await db.selectFrom('agent_assignments').select('agent').distinct().where('scope', '=', 'global').execute()).map(
      (r) => r.agent,
    ),
  );
  for (const [agent, engine] of Object.entries(DEFAULT_AGENT_ENGINES)) {
    if (touchedAgents.has(agent) || !catalog.get(agent)) continue;
    await insertChoice(db, { agent }, engine, by);
    seeded.push(agent);
  }
  return seeded;
}
