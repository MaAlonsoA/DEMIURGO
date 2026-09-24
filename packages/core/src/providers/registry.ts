// Registry of the providers this process can run: the engine resolves each run's provider here.

import type { Provider } from '@demiurgo/domain';

export type ProviderRegistry = {
  get(id: string): Provider | undefined;
  list(): readonly Provider[];
};

export function createProviderRegistry(providers: readonly Provider[]): ProviderRegistry {
  const byId = new Map<string, Provider>(providers.map((p) => [p.id, p]));
  return { get: (id) => byId.get(id), list: () => providers };
}
