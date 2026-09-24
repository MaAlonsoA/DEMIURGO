// Tests generated from the design/data/ tables: 403 from the capability matrix,
// 409 from the transition tables, and the "decisive only human" property (I1).

import { randomUUID } from 'node:crypto';
import {
  type Actor,
  COMMAND_NAMES,
  ENTITY_NAMES,
  type CommandName,
  ACTOR_TYPES,
  commandDefinition,
  entityDefinition,
  isCreation,
  isDecisive,
  human,
  implementedIn,
  SETTING_NAMES,
  CAPABILITIES,
} from '@demiurgo/domain';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../../src/bus/bus.ts';
import { SETTINGS } from '../../src/assignments/settings.ts';
import { createSimulatedProvider } from '../../src/agents/simulated.ts';
import { createProviderRegistry } from '../../src/providers/registry.ts';
import { useEnvironment } from '../support/env.ts';
import { ACTOR_BY_TYPE, RECIPES, allowedActor, currentIncrement, moveTo } from '../support/factory.ts';
import '../support/recipes.ts';

const environment = useEnvironment();
let projectId = '';

beforeAll(async () => {
  const r = await executeCommand(environment().services, {
    command: 'project.create',
    actor: human('ana'),
    data: { name: 'Tables' },
  });
  projectId = r.projectId;
});

async function numberOfEvents(): Promise<number> {
  const r = await environment()
    .services.db.selectFrom('events')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

const cases403 = COMMAND_NAMES.flatMap((command) => {
  const allowed = commandDefinition(command).allowed;
  const actors: Actor[] = ACTOR_TYPES.filter((t) => !allowed.includes(t)).map((t) => ACTOR_BY_TYPE[t]);
  actors.push({ type: 'unknown' });
  return actors.map((actor) => ({ command, actor }));
});

describe('AC-ESQ-001-02 403 generated from the capability matrix', () => {
  it.each(cases403)('AC-ESQ-001-02 $command with $actor.type is rejected with no effects', async ({ command, actor }) => {
    const before = await numberOfEvents();
    const p = executeCommand(environment().services, { command, actor, projectId, entityId: randomUUID(), data: {} });
    await expect(p).rejects.toMatchObject({ type: 'forbidden' });
    expect(await numberOfEvents()).toBe(before);
  });
});

const increment = currentIncrement();
const cases409 = ENTITY_NAMES.filter((e) => implementedIn(e, increment)).flatMap((entity) => {
  const def = entityDefinition(entity);
  const commands = [...new Set(def.transitions.map((t) => t.command as CommandName))].filter((c) => !isCreation(c));
  return Object.keys(def.states).flatMap((state) =>
    commands
      .filter((c) => !def.transitions.some((t) => t.command === c && t.from !== 'new' && t.from.includes(state)))
      .map((command) => ({ entity, state, command })),
  );
});

describe('AC-ESQ-001-03 409 generated from the transition tables', () => {
  it('AC-ESQ-001-03 there are recipes for every implemented entity', () => {
    const withoutRecipe = ENTITY_NAMES.filter((e) => implementedIn(e, increment) && !RECIPES[e]);
    expect(withoutRecipe).toEqual([]);
    expect(cases409.length).toBeGreaterThan(0);
  });

  it.each(cases409)(
    'AC-ESQ-001-03 $command on $entity in "$state" is rejected with no effects',
    async ({ entity, state, command }) => {
      const s = environment().services;
      const id = await moveTo(s, projectId, entity, state);
      const pid = entity === 'project' ? id : projectId;
      const before = await numberOfEvents();
      const recipe = RECIPES[entity];
      const data = (await recipe?.data?.[command]?.({ s, projectId: pid, entityId: id })) ?? {};
      const p = executeCommand(s, { command, actor: allowedActor(command), projectId: pid, entityId: id, data });
      await expect(p).rejects.toMatchObject({ type: 'invalid_transition' });
      expect(await numberOfEvents()).toBe(before);
    },
  );
});

describe('AC-DIS-001-04 property: every decisive command with a non-human actor is rejected with no effects', () => {
  const decisiveCommands = COMMAND_NAMES.filter(isDecisive);
  const nonHuman: Actor[] = [ACTOR_BY_TYPE.agent_external, ACTOR_BY_TYPE.agent_run, ACTOR_BY_TYPE.system, { type: 'unknown' }];

  it('AC-DIS-001-04 there are decisive commands and all of them reach an authority state', () => {
    expect(decisiveCommands.length).toBeGreaterThanOrEqual(8);
  });

  it('AC-DIS-001-04 for any decisive command, non-human actor and arbitrary data', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...decisiveCommands),
        fc.constantFrom(...nonHuman),
        fc.anything(),
        fc.uuid(),
        async (command, actor, data, entityId) => {
          const before = await numberOfEvents();
          const p = executeCommand(environment().services, { command, actor, projectId, entityId, data });
          await expect(p).rejects.toMatchObject({ type: 'forbidden' });
          expect(await numberOfEvents()).toBe(before);
        },
      ),
      { numRuns: 200 },
    );
  });
});

const settingCases = SETTING_NAMES.flatMap((setting) => {
  const allowed: readonly string[] = CAPABILITIES.settings[setting].allowed;
  const actors: Actor[] = ACTOR_TYPES.filter((t) => !allowed.includes(t)).map((t) => ACTOR_BY_TYPE[t]);
  actors.push({ type: 'unknown' });
  return actors.map((actor) => ({ setting, actor }));
});

async function settingRows(): Promise<number> {
  const db = environment().services.db;
  const a = await db
    .selectFrom('agent_assignments')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .executeTakeFirstOrThrow();
  const c = await db
    .selectFrom('provider_catalogs')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .executeTakeFirstOrThrow();
  return Number(a.n) + Number(c.n);
}

describe('AC-AGE-002-02 403 generated from the workspace settings of the matrix', () => {
  it.each(settingCases)('AC-AGE-002-02 $setting with $actor.type is rejected with no effects', async ({ setting, actor }) => {
    const deps = { db: environment().services.db, providers: createProviderRegistry([createSimulatedProvider()]) };
    const before = await settingRows();
    const data = { agent: 'echo', scope: 'global', provider: 'simulated', model: 'simulated', effort: null };
    await expect(SETTINGS[setting](deps, actor, data)).rejects.toMatchObject({ type: 'forbidden' });
    expect(await settingRows()).toBe(before);
  });
});
