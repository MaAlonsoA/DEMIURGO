// H59: the NFRs of the «Global quality» stage are proposed once. Two runs after the stage passed
// (the one answering the person and the deferred one of the next stage) both propose them, in other
// words: the second set is dropped, a quality attribute with none yet still goes through, and the
// context tells the explorer what is already pending.

import { human } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SCRIPTS, createSimulatedProvider } from '../src/agents/simulated.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { waitForRun } from '../src/engine/engine.ts';
import { sameQualityAttribute } from '../src/actions/nfr-dedupe.ts';
import { useEnvironment } from './support/env.ts';

const nfr = (title: string, attribute: string) => ({
  type: 'design_record',
  record_type: 'quality_requirement',
  title,
  sections: [
    { title: 'Quality attribute', content: attribute },
    { title: 'Scenario', content: 'Stimulus → response.' },
    { title: 'Measure', content: 'A number.' },
  ],
  criteria: [],
  quotes: [],
});

let turn = 0;
const TURNS = [
  [nfr('Response time at personal-use scale', 'Performance.'), nfr('Recovery of saved work', 'Recoverability.')],
  [
    nfr('Personal recipe app response times', 'Performance.'),
    nfr('Recovery of saved recipe records', 'Availability and recoverability.'),
    nfr('Sign-in protects personal records', 'Security.'),
  ],
];
let seenPending: unknown[] = [];

const environment = useEnvironment({
  durable: true,
  providers: () => [
    createSimulatedProvider({
      scripts: {
        exploration_chat: (p) => {
          const out = DEFAULT_SCRIPTS.exploration_chat(p) as { proposals: unknown[] };
          seenPending = (p.context.content as { pending_quality_requirements?: unknown[] }).pending_quality_requirements ?? [];
          out.proposals.push(...(TURNS[turn++] ?? []));
          return out;
        },
      },
    }),
  ],
});

const ana = human('ana');
let projectId = '';
let thread = '';
type Cmd = Parameters<typeof executeCommand>[1]['command'];
const cmd = (command: Cmd, data: unknown) => executeCommand(environment().services, { command, actor: ana, projectId, data });

async function talk(text: string) {
  const posted = await cmd('message.post', { exploration_id: thread, text, respond: true });
  const s = environment().services;
  for (let i = 0; i < 400; i++) {
    const m = await s.db.selectFrom('messages').select('response_run').where('id', '=', posted.entityId).executeTakeFirst();
    if (m?.response_run) {
      await waitForRun(m.response_run);
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('The run did not end.');
}

beforeAll(async () => {
  projectId = (await executeCommand(environment().services, { command: 'project.create', actor: ana, data: { name: 'Recipes' } })).projectId;
  thread = (await cmd('exploration.open', { purpose: 'A recipe app' })).entityId;
});

describe('H59 NFRs proposed once', () => {
  it('matches the same quality attribute worded differently', () => {
    expect(sameQualityAttribute('Performance.', 'Performance and user control.')).toBe(true);
    expect(sameQualityAttribute('Recoverability.', 'Availability and recoverability.')).toBe(true);
    expect(sameQualityAttribute('Data retention and ownership.', 'Data ownership and retention.')).toBe(true);
    expect(sameQualityAttribute('Security.', 'Performance.')).toBe(false);
  });

  it('two turns after the quality stage passed leave one set of NFR proposals', async () => {
    await talk('The quality goals are confirmed. [turn 1]');
    expect(seenPending).toEqual([]);
    await talk('Opening the next stage. [turn 2]');
    // The second run is told what is already waiting.
    expect(seenPending).toHaveLength(2);
    const rows = await environment()
      .services.db.selectFrom('proposals')
      .select(['payload', 'state'])
      .where('project_id', '=', projectId)
      .where('type', '=', 'design_record')
      .execute();
    const titles = rows.map((r) => (r.payload as { title: string }).title).toSorted();
    expect(titles).toEqual(['Recovery of saved work', 'Response time at personal-use scale', 'Sign-in protects personal records']);
  });
});
