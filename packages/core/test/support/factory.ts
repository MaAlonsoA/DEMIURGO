// Generic factory for the tests generated from the tables: creates an entity and moves it to any
// state by following legal transitions from design/data/transitions.yaml.

import { readFileSync } from 'node:fs';
import {
  type Actor,
  type CommandName,
  type EntityName,
  type ActorType,
  externalAgent,
  agentRun,
  commandDefinition,
  entityDefinition,
  human,
  system,
} from '@demiurgo/domain';
import { executeCommand } from '../../src/bus/bus.ts';
import type { Services } from '../../src/services.ts';

export const ACTOR_BY_TYPE: Record<ActorType, Actor> = {
  human: human('ana'),
  agent_external: externalAgent('bot-test', 'session-1'),
  agent_run: agentRun('00000000-0000-7000-8000-00000000abcd'),
  system: system('test'),
};

export function allowedActor(command: CommandName): Actor {
  const type = commandDefinition(command).allowed[0] as ActorType;
  return ACTOR_BY_TYPE[type];
}

/** Last implemented increment, per package.json. */
export function currentIncrement(): string {
  const root = JSON.parse(readFileSync('package.json', 'utf8')) as { demiurgo: { implementedIncrements: string[] } };
  const s = root.demiurgo.implementedIncrements.filter((i) => i.startsWith('S'));
  return s[s.length - 1] ?? 'S0';
}

export type Context = { s: Services; projectId: string; entityId: string };

export type Recipe = {
  /** Creates the entity in its initial state and returns its id. */
  create(s: Services, projectId: string): Promise<string>;
  /** Valid data for each non-creating command. Defaults to `{}`. */
  data?: Partial<Record<CommandName, (c: Context) => unknown>>;
  /** Custom paths for states whose guards require preparation. */
  states?: Partial<Record<string, (s: Services, projectId: string) => Promise<string>>>;
};

let counter = 0;
export const unique = (prefix: string): string => `${prefix}-${Date.now()}-${++counter}`;

export const RECIPES: Partial<Record<EntityName, Recipe>> = {
  project: {
    async create(s) {
      const r = await executeCommand(s, { command: 'project.create', actor: human('ana'), data: { name: unique('P') } });
      return r.entityId;
    },
  },
  context_pack: {
    async create(s, projectId) {
      const r = await executeCommand(s, {
        command: 'context_pack.build',
        actor: system('test'),
        projectId,
        data: { role: 'echo', constructor: 'echo@1', budget: {}, graph_version: 0, dependencies: [], content: unique('c') },
      });
      return r.entityId;
    },
  },
  ai_run: {
    async create(s, projectId) {
      const r = await executeCommand(s, {
        command: 'run.request',
        actor: human('ana'),
        projectId,
        data: { action: 'echo', scope: { type: 'project' }, input: { text: unique('t') } },
      });
      return r.entityId;
    },
    data: {
      'run.complete': () => ({ output: { reply: 'x' }, usage: null, model: null }),
      'run.fail': () => ({ failure_kind: 'agent_error', error: 'x' }),
      'run.interrupt': () => ({ reason: 'x' }),
    },
  },
};

export function registerRecipe(entity: EntityName, recipe: Recipe): void {
  RECIPES[entity] = recipe;
}

/** Path of commands (excluding creation) from the initial state to `target`, by BFS. */
export function commandPath(entity: EntityName, initial: string, target: string): CommandName[] | null {
  const def = entityDefinition(entity);
  const queue: [string, CommandName[]][] = [[initial, []]];
  const seen = new Set([initial]);
  while (queue.length > 0) {
    const [state, path] = queue.shift() as [string, CommandName[]];
    if (state === target) return path;
    for (const t of def.transitions) {
      if (t.from === 'new' || !t.from.includes(state) || seen.has(t.to)) continue;
      seen.add(t.to);
      queue.push([t.to, [...path, t.command as CommandName]]);
    }
  }
  return null;
}

export async function moveTo(s: Services, projectId: string, entity: EntityName, target: string): Promise<string> {
  const recipe = RECIPES[entity];
  if (!recipe) throw new Error(`No recipe for "${entity}".`);
  const custom = recipe.states?.[target];
  if (custom) return custom(s, projectId);
  const id = entity === 'project' ? await recipe.create(s, projectId) : await recipe.create(s, projectId);
  const pid = entity === 'project' ? id : projectId;
  const row = await currentState(s, entity, id);
  const path = commandPath(entity, row, target);
  if (!path) throw new Error(`"${entity}" cannot reach "${target}" from "${row}".`);
  for (const command of path) {
    const data: unknown = await Promise.resolve(recipe.data?.[command]?.({ s, projectId: pid, entityId: id }) ?? {});
    await executeCommand(s, { command, actor: allowedActor(command), projectId: pid, entityId: id, data });
  }
  return id;
}

const TABLE: Partial<Record<EntityName, string>> = {};
export async function currentState(s: Services, entity: EntityName, id: string): Promise<string> {
  const { TABLES } = await import('../../src/bus/bus.ts');
  const table = TABLE[entity] ?? TABLES[entity];
  if (!table) throw new Error(`No table for ${entity}`);
  const { sql } = await import('kysely');
  const { rows } = await sql<{ state: string }>`select state from ${sql.table(table)} where id = ${id}::uuid`.execute(s.db);
  return rows[0]?.state ?? '';
}
