// The workspace settings of the capability matrix (`settings` in design/data/capabilities.yaml), each
// with its data validation (422) and its function. The matrix decides who may run each (403).

import { type Actor, DomainError, type SettingName } from '@demiurgo/domain';
import { z } from 'zod';
import { assignAgent, unassignAgent } from './assignments.ts';
import { type SettingsDeps, refreshCatalogs, requireSetting } from './catalogs.ts';

const target = z
  .object({ agent: z.string().min(1), scope: z.enum(['global', 'project']), project_id: z.string().optional() })
  .strict();

const engine = z.object({ provider: z.string().min(1), model: z.string().min(1), effort: z.string().min(1).nullable() }).strict();

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
  'agent.assign': (deps, actor, data) => {
    const d = parse(target.extend(engine.shape).strict(), data, 'agent.assign');
    return assignAgent(deps, actor, {
      agent: d.agent,
      scope: d.scope,
      ...(d.project_id === undefined ? {} : { projectId: d.project_id }),
      provider: d.provider,
      model: d.model,
      effort: d.effort,
    });
  },
  'agent.unassign': (deps, actor, data) => {
    const d = parse(target, data, 'agent.unassign');
    return unassignAgent(deps, actor, {
      agent: d.agent,
      scope: d.scope,
      ...(d.project_id === undefined ? {} : { projectId: d.project_id }),
    });
  },
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
