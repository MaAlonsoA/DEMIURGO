// Pruebas generadas desde las tablas de design/datos/: 403 por la matriz de capacidades,
// 409 por las tablas de transiciones y la propiedad «decisivo solo humano» (I1).

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
} from '@demiurgo/domain';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../../src/bus/bus.ts';
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

describe('AC-ESQ-001-02 403 generado desde la matriz de capacidades', () => {
  it.each(cases403)('AC-ESQ-001-02 $comando con $actor.tipo se rechaza sin efectos', async ({ command, actor }) => {
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

describe('AC-ESQ-001-03 409 generado desde las tablas de transiciones', () => {
  it('AC-ESQ-001-03 hay recetas para todas las entidades implementadas', () => {
    const withoutRecipe = ENTITY_NAMES.filter((e) => implementedIn(e, increment) && !RECIPES[e]);
    expect(withoutRecipe).toEqual([]);
    expect(cases409.length).toBeGreaterThan(0);
  });

  it.each(cases409)(
    'AC-ESQ-001-03 $comando sobre $entidad en «$estado» se rechaza sin efectos',
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

describe('AC-DIS-001-04 propiedad: todo comando decisivo con actor no humano se rechaza sin efectos', () => {
  const decisiveCommands = COMMAND_NAMES.filter(isDecisive);
  const nonHuman: Actor[] = [ACTOR_BY_TYPE.agent_external, ACTOR_BY_TYPE.agent_run, ACTOR_BY_TYPE.system, { type: 'unknown' }];

  it('AC-DIS-001-04 hay comandos decisivos y todos alcanzan un estado de autoridad', () => {
    expect(decisiveCommands.length).toBeGreaterThanOrEqual(8);
  });

  it('AC-DIS-001-04 para cualquier comando decisivo, actor no humano y datos arbitrarios', async () => {
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
