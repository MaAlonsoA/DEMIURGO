// Default engines (V2.1): the person's chosen configuration, seeded at startup for every agent that
// has no global assignment yet (after a snapshot restore or a reset). What the person assigns in
// Models & providers always wins: an agent with any global row, even an unassignment, is left alone.

import { formatActor, system } from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';
import type { Engine } from './assignments.ts';

export const DEFAULT_ENGINES: Readonly<Record<string, Engine>> = {
  onboarding: { provider: 'codex', model: 'gpt-6-astra', effort: 'medium' },
  explorer: { provider: 'codex', model: 'gpt-6-astra', effort: 'medium' },
  designer: { provider: 'claude', model: 'opus', effort: 'high' },
  knowledge_classifier: { provider: 'codex', model: 'gpt-6-luna', effort: 'low' },
  knowledge_reviewer: { provider: 'codex', model: 'gpt-6-luna', effort: 'low' },
  echo: { provider: 'opencode', model: 'qwen-local/qwen3.8-27b', effort: 'high' },
};

/** Inserts the default global assignment of each agent that has none. Returns the agents seeded. */
export async function seedDefaultEngines(db: Db): Promise<string[]> {
  const existing = await db
    .selectFrom('agent_assignments')
    .select('agent')
    .distinct()
    .where('scope', '=', 'global')
    .execute();
  const have = new Set(existing.map((r) => r.agent));
  const missing = Object.entries(DEFAULT_ENGINES).filter(([agent]) => !have.has(agent));
  if (missing.length === 0) return [];
  await db
    .insertInto('agent_assignments')
    .values(
      missing.map(([agent, e]) => ({
        scope: 'global',
        project_id: null,
        agent,
        provider: e.provider,
        model: e.model,
        effort: e.effort,
        assigned_by: formatActor(system('defaults')),
        assigned_at: new Date(),
      })),
    )
    .execute();
  return missing.map(([agent]) => agent);
}
