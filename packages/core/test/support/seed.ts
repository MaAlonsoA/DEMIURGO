// Seeds for tests and the e2e server: a provider's catalog and every agent assigned to the simulated
// provider, as a person would leave them in Models & providers.

import type { ProviderModel } from '@demiurgo/domain';
import { loadAgentCatalog } from '../../src/agents/catalog.ts';
import type { Db } from '../../src/db/connection.ts';

export async function seedCatalog(db: Db, provider: string, models: readonly ProviderModel[], label?: string): Promise<void> {
  await db
    .insertInto('provider_catalogs')
    .values({
      provider,
      discovered_by: 'system:test',
      label: label ?? `${provider[0]?.toUpperCase() ?? ''}${provider.slice(1)}`,
      installed: true,
      version: 'test',
      ready: true,
      message: null,
      sessions: true,
      models: JSON.stringify(models),
    })
    .execute();
}

/** The simulated catalog, every group of agents on it, and on it too each agent without a group. */
export async function seedSimulated(db: Db): Promise<void> {
  await seedCatalog(
    db,
    'simulated',
    [{ id: 'simulated', label: 'Simulated (deterministic)', efforts: [], defaultEffort: null }],
    'Simulated',
  );
  const engine = { provider: 'simulated', model: 'simulated', effort: null };
  const catalog = await loadAgentCatalog();
  for (const group of catalog.groups) {
    await db
      .insertInto('group_assignments')
      .values({ group_id: group.id, ...engine, assigned_by: 'human:setup' })
      .execute();
  }
  for (const agent of catalog.agents.filter((a) => a.group === null)) {
    await db
      .insertInto('agent_assignments')
      .values({ scope: 'global', project_id: null, agent: agent.id, ...engine, assigned_by: 'human:setup' })
      .execute();
  }
}
