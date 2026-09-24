// Catalog of what each provider offers (FDR-AGE-002): discovered without spending quota, on startup
// and when the person presses Refresh. Append-only: the current catalog of a provider is its latest.

import {
  type Actor,
  DomainError,
  type ProviderCatalog,
  type ProviderId,
  type ProviderModel,
  allowedForSetting,
  formatActor,
} from '@demiurgo/domain';
import { sql } from 'kysely';
import type { Db, Tx } from '../db/connection.ts';
import type { ProviderRegistry } from '../providers/registry.ts';

/** What the settings functions need: the database and the providers this process runs. */
export type SettingsDeps = { db: Db; providers: ProviderRegistry };

export type StoredCatalog = ProviderCatalog & { discoveredAt: string };

type CatalogRow = {
  provider: string;
  label: string;
  discovered_at: Date;
  installed: boolean;
  version: string | null;
  ready: boolean;
  message: string | null;
  sessions: boolean;
  models: unknown;
};

function stored(r: CatalogRow): StoredCatalog {
  return {
    provider: r.provider as ProviderId,
    label: r.label,
    installed: r.installed,
    version: r.version,
    ready: r.ready,
    message: r.message,
    sessions: r.sessions,
    models: (Array.isArray(r.models) ? r.models : []) as ProviderModel[],
    discoveredAt: new Date(r.discovered_at).toISOString(),
  };
}

export function requireSetting(name: Parameters<typeof allowedForSetting>[0], actor: Actor): void {
  if (!allowedForSetting(name, actor.type)) {
    throw new DomainError('forbidden', `${formatActor(actor)} cannot change "${name}".`, [
      'Only a person changes the models and providers.',
    ]);
  }
}

/** Latest catalog of each provider (of those registered, if a registry is given). */
export async function currentCatalogs(db: Db | Tx, providers?: ProviderRegistry): Promise<StoredCatalog[]> {
  const { rows } = await sql<CatalogRow>`
    select distinct on (provider) provider, label, discovered_at, installed, version, ready, message, sessions, models
    from provider_catalogs order by provider, discovered_at desc, id desc`.execute(db);
  return rows.filter((r) => !providers || providers.get(r.provider)).map(stored);
}

/** Latest catalog of one provider, or null if it was never discovered. */
export async function catalogOf(db: Db | Tx, provider: string): Promise<StoredCatalog | null> {
  const { rows } = await sql<CatalogRow>`
    select provider, label, discovered_at, installed, version, ready, message, sessions, models
    from provider_catalogs where provider = ${provider} order by discovered_at desc, id desc limit 1`.execute(db);
  const row = rows[0];
  return row ? stored(row) : null;
}

/** Discovers every registered provider again and stores what each one offers now. */
export async function refreshCatalogs(deps: SettingsDeps, actor: Actor): Promise<StoredCatalog[]> {
  requireSetting('providers.refresh', actor);
  const found = await Promise.all(
    deps.providers.list().map(async (p): Promise<ProviderCatalog> => {
      try {
        return await p.discover();
      } catch (e) {
        return {
          provider: p.id,
          label: p.label,
          installed: false,
          version: null,
          ready: false,
          message: `Discovery failed: ${e instanceof Error ? e.message : String(e)}`,
          sessions: p.sessions,
          models: [],
        };
      }
    }),
  );
  for (const c of found) {
    await deps.db
      .insertInto('provider_catalogs')
      .values({
        provider: c.provider,
        discovered_by: formatActor(actor),
        label: c.label,
        installed: c.installed,
        version: c.version,
        ready: c.ready,
        message: c.message,
        sessions: c.sessions,
        models: JSON.stringify(c.models),
      })
      .execute();
  }
  return currentCatalogs(deps.db, deps.providers);
}
