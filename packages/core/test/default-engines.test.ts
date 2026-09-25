// Default engines at startup (V2.2): a workspace from before the groups keeps running every agent on
// the same engine. Each group takes the engine most of its agents already had, the agents that match
// it follow the group, the ones that differ stay as exceptions, and a second start changes nothing.

import { formatActor, human } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import { createSimulatedProvider } from '../src/agents/simulated.ts';
import { currentAssignments, resolveEngine } from '../src/assignments/assignments.ts';
import { mostCommonEngine, seedDefaultEngines } from '../src/assignments/defaults.ts';
import { createProviderRegistry } from '../src/providers/registry.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment({ seedAssignments: false });

const ASTRA = { provider: 'codex', model: 'gpt-6-astra', effort: 'medium' };
const LUNA = { provider: 'codex', model: 'gpt-6-luna', effort: 'low' };
const OPUS = { provider: 'claude', model: 'opus', effort: 'high' };

describe('default engines', () => {
  it('the most common engine wins, and the first one seen on a tie', () => {
    expect(mostCommonEngine([ASTRA, OPUS, ASTRA])).toEqual(ASTRA);
    expect(mostCommonEngine([OPUS, ASTRA])).toEqual(OPUS);
    expect(mostCommonEngine([])).toBeNull();
  });

  it('agents assigned one by one become groups with the same engines, and the odd one out stays an exception', async () => {
    const { db } = environment().services;
    const before: Record<string, typeof ASTRA> = {
      onboarding: ASTRA,
      explorer: ASTRA,
      designer: OPUS,
      knowledge_classifier: LUNA,
      knowledge_reviewer: LUNA,
    };
    for (const [agent, e] of Object.entries(before)) {
      await db
        .insertInto('agent_assignments')
        .values({ scope: 'global', project_id: null, agent, ...e, assigned_by: formatActor(human('ana')) })
        .execute();
    }

    expect((await seedDefaultEngines(db)).toSorted()).toEqual(['echo', 'group:deep', 'group:quick']);
    const current = await currentAssignments(db);
    expect(current.groups.deep?.engine).toEqual(ASTRA);
    expect(current.groups.quick?.engine).toEqual(LUNA);
    // Only the exceptions keep their own engine: designer on Opus, and echo, which has no group.
    expect(Object.keys(current.agents).toSorted()).toEqual(['designer', 'echo']);
    expect(current.agents.designer?.engine).toEqual(OPUS);

    // Every agent resolves to exactly the engine it had.
    const providers = createProviderRegistry([createSimulatedProvider()]);
    for (const [agent, e] of Object.entries(before)) {
      expect(await resolveEngine(db, providers, { agent })).toMatchObject({
        provider: e.provider,
        model: e.model,
        effort: e.effort,
      });
    }

    // A second start leaves everything as it is.
    expect(await seedDefaultEngines(db)).toEqual([]);
    expect(await currentAssignments(db)).toEqual(current);
  });
});
