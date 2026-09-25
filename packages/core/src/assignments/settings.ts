// The workspace settings of the capability matrix (`settings` in design/data/capabilities.yaml), each
// with its data validation (422) and its function. The matrix decides who may run each (403).

import { type Actor, DomainError, type SettingName } from '@demiurgo/domain';
import { z } from 'zod';
import { assignAgent, unassignAgent } from './assignments.ts';
import { type SettingsDeps, refreshCatalogs, requireSetting } from './catalogs.ts';

// A choice is for one group of agents or for one agent (an exception to its group), for every project.
const target = z.union([z.object({ group: z.string().min(1) }).strict(), z.object({ agent: z.string().min(1) }).strict()]);

const engine = z.object({ provider: z.string().min(1), model: z.string().min(1), effort: z.string().min(1).nullable() }).strict();

const assignment = z.union([
  z.object({ group: z.string().min(1), ...engine.shape }).strict(),
  z.object({ agent: z.string().min(1), ...engine.shape }).strict(),
]);

function parse<T>(schema: z.ZodType<T>, data: unknown, name: string): T {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    throw new DomainError(
      'validation',
      `The data for "${name}" is invalid.`,
      r.error.issues.map((i) => `${i.path.join('.') || 'data'}: ${i.message}`),
    );
  }
  return r.data;
}

type Setting = (deps: SettingsDeps, actor: Actor, data: unknown) => Promise<unknown>;

const HANDLERS: Record<SettingName, Setting> = {
  'agent.assign': (deps, actor, data) => assignAgent(deps, actor, parse(assignment, data, 'agent.assign')),
  'agent.unassign': (deps, actor, data) => unassignAgent(deps, actor, parse(target, data, 'agent.unassign')),
  'providers.refresh': (deps, actor) => refreshCatalogs(deps, actor),
};

/** Same order as the bus: capability (403) before data validation (422). */
export const SETTINGS = Object.fromEntries(
  Object.entries(HANDLERS).map(([name, run]) => [
    name,
    async (deps: SettingsDeps, actor: Actor, data: unknown) => {
      requireSetting(name as SettingName, actor);
      return run(deps, actor, data);
    },
  ]),
) as Record<SettingName, Setting>;
