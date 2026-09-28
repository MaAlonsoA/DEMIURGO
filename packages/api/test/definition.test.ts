// Day 1 through the API, end to end with the simulated provider: the idea is read, DEMIURGO infers
// what it says (citing the person's words) and leaves the rest open, the person confirms in a block,
// the system proposes the product definition, the person approves it, the next thread's run reads it
// whole, the dev trace walks a section back to the sentence of the idea it comes from, and a decision
// in another thread changes it.

import { type ProductDefinition, type Trace, waitForKnowledge, waitForRun } from '@demiurgo/core';
import { DEFINITION_SECTIONS } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DevTools } from '../src/dev-tools.ts';
import { useApi } from './support/api.ts';

const fake: DevTools = {
  database: 'test',
  ready: async () => undefined,
  list: async () => [],
  save: async () => {
    throw new Error('not in this test');
  },
  restore: async () => {
    throw new Error('not in this test');
  },
  drop: async () => {
    throw new Error('not in this test');
  },
  reset: async () => undefined,
};

const api = useApi({ durable: true }, { devTools: fake });
const IDEA = 'Members sign up for club trips and organizers see who is coming. They pay at the door. [infer]';
const SENTENCE = 'Members sign up for club trips and organizers see who is coming.';
let projectId = '';
let thread = '';

type Question = {
  id: string;
  state: string;
  conclusion: string | null;
  stage_key: string | null;
  evidence?: { quote: string }[];
};

async function command(name: string, data: unknown, entityId?: string) {
  const r = await api().person.request('POST', `/api/projects/${projectId}/commands/${name}`, {
    data,
    ...(entityId ? { entity_id: entityId } : {}),
  });
  if (r.statusCode !== 200) throw new Error(`${name}: ${r.statusCode} ${r.body}`);
  return r.json<{ entity_id: string; result?: unknown }>();
}

async function ask(explorationId: string, text: string): Promise<string> {
  // A run starts on up-to-date knowledge: after an approval, the update has to finish first.
  await waitForKnowledge(api().environment.services, projectId);
  await command('message.post', { exploration_id: explorationId, text, respond: false });
  const run = await command('run.request', { action: 'exploration_chat', scope: { type: 'exploration', id: explorationId } });
  await waitForRun(run.entity_id);
  return run.entity_id;
}

const get = async <T>(url: string) => (await api().person.request('GET', url)).json<T>();
const questionsOf = async (id: string) =>
  (await get<{ questions: Question[] }>(`/api/projects/${projectId}/explorations/${id}`)).questions.filter((q) => q.stage_key);
const definition = () => get<ProductDefinition>(`/api/projects/${projectId}/definition`);

beforeAll(async () => {
  const p = await api().person.request('POST', '/api/projects', { name: 'Club trips' });
  projectId = p.json<{ project_id: string }>().project_id;
  thread = (await command('exploration.open', { purpose: 'An app for our club trips' })).entity_id;
});

describe('Day 1 leaves a product definition behind', () => {
  it('DEMIURGO infers what the idea says, citing it, and leaves the rest open', async () => {
    await ask(thread, IDEA);
    const questions = await questionsOf(thread);
    expect(questions).toHaveLength(8);
    const inferred = questions.filter((q) => q.state === 'inferred');
    expect(inferred).toHaveLength(6);
    for (const q of inferred) expect(q.evidence?.map((e) => e.quote)).toEqual([SENTENCE]);
    expect(questions.filter((q) => q.state === 'pending')).toHaveLength(2);
    expect((await definition()).proposal).toBeNull();
  });

  it('confirming everything in a block proposes the definition, each section with how it was settled', async () => {
    for (const q of await questionsOf(thread))
      await command('question.confirm', q.state === 'pending' ? { conclusion: `Answered: ${q.stage_key}.` } : {}, q.id);
    const d = await definition();
    expect(d.record).toBeNull();
    expect(d.proposal?.sections.map((s) => s.title)).toEqual(DEFINITION_SECTIONS.map((s) => s.title));
    const settled = d.proposal?.sources.map((s) => s.question?.settled);
    expect(settled?.filter((s) => s === 'assumed')).toHaveLength(6);
    expect(settled?.filter((s) => s === 'answered')).toHaveLength(2);
    expect(d.proposal?.sources.find((s) => s.question?.settled === 'assumed')?.question?.evidence[0]?.quote).toBe(SENTENCE);
  });

  it('the person approves it: version 1, with its sources, and nothing waiting', async () => {
    const d = await definition();
    await command('proposal.accept', { approve: true }, d.proposal?.id);
    const after = await definition();
    expect(after.record?.code).toMatch(/^DEF-/);
    expect(after.versions.map((v) => [v.n, v.state])).toEqual([[1, 'approved']]);
    expect(after.versions[0]?.sources.every((s) => s.question?.settled_by === 'human:ana')).toBe(true);
    expect(after.proposal).toBeNull();
  });

  it('the next thread reads it whole in its run, and depends on it', async () => {
    const other = (await command('exploration.open', { purpose: 'Paying for trips' })).entity_id;
    const runId = await ask(other, 'How do members pay?');
    const run = await get<{
      context_pack: {
        dependencies: { type: string; id: string; version: number }[];
        content: { product_definition?: { version: number; sections: unknown[] } };
      };
    }>(`/api/projects/${projectId}/runs/${runId}`);
    const d = await definition();
    expect(run.context_pack.content.product_definition?.version).toBe(1);
    expect(run.context_pack.content.product_definition?.sections).toHaveLength(8);
    expect(run.context_pack.dependencies).toContainEqual({ type: 'record', id: d.record?.id, version: 1 });
  });
});

describe('the dev trace', () => {
  it('walks the definition back to the sentence of the idea, and names the runs that read it', async () => {
    const d = await definition();
    const version = d.versions[0]?.id ?? '';
    const r = await api().person.request('GET', `/api/dev/trace?project=${projectId}&type=record_version&id=${version}`);
    expect(r.statusCode).toBe(200);
    const trace = r.json<Trace>();
    const types = trace.origin.map((s) => s.type);
    expect(types[0]).toBe('record_version');
    expect(types).toContain('proposal');
    expect(trace.origin.find((s) => s.type === 'batch')?.actor).toBe('system:definition@1');
    expect(trace.origin.filter((s) => s.label === 'inferred by DEMIURGO')).toHaveLength(6);
    expect(trace.origin.find((s) => s.type === 'message')?.label).toBe(IDEA);
    expect(types).toContain('run');
    expect(trace.read_by.tracked).toBe(true);
    expect(trace.read_by.packs.some((p) => p.version === 1 && p.runs.some((x) => x.action === 'exploration_chat'))).toBe(true);
  });

  it('a question shows its raw data and the packs that carried it', async () => {
    const q = (await questionsOf(thread)).find((x) => x.evidence?.length);
    const trace = (
      await api().person.request('GET', `/api/dev/trace?project=${projectId}&type=question&id=${q?.id}`)
    ).json<Trace>();
    expect(trace.entity.row.id).toBe(q?.id);
    expect(trace.events.map((e) => e.command)).toEqual(
      expect.arrayContaining(['question.raise', 'question.infer', 'question.confirm']),
    );
    expect(trace.read_by.packs.length).toBeGreaterThan(0);
  });
});

describe('a decision in another thread changes the definition', () => {
  const DECIDED = 'A web app, used from the browser.';
  let other = '';

  it('DEMIURGO proposes the change there, on the words of the person, and the Product page lists it', async () => {
    other = (await command('exploration.open', { purpose: 'Where it runs' })).entity_id;
    await ask(other, `${DECIDED} [redefine]`);
    const d = await definition();
    expect(d.changes).toHaveLength(1);
    expect(d.changes[0]).toMatchObject({
      exploration_id: other,
      section: 'Constraints',
      content: DECIDED,
      base: { version: 1 },
      evidence: [{ quote: DECIDED }],
    });
  });

  it('accepting it is one step: version 2 is in force, its section says where it was decided', async () => {
    const [change] = (await definition()).changes;
    await command('proposal.accept', {}, change?.id);
    const d = await definition();
    expect(d.changes).toEqual([]);
    expect(d.proposal).toBeNull();
    expect(d.versions.map((v) => [v.n, v.state])).toEqual([
      [2, 'approved'],
      [1, 'superseded'],
    ]);
    const current = d.versions[0];
    expect(current?.sections.find((s) => s.title === 'Constraints')?.content).toBe(DECIDED);
    expect(current?.from_thread).toMatchObject({ proposal_id: change?.id, exploration_id: other });
    expect(current?.reasons).toEqual([{ section: 'Constraints', why: `Decided in this thread: ${DECIDED}`, own_words: null }]);
  });

  it('the trace of version 2 reaches the message where the person decided it', async () => {
    const version = (await definition()).versions[0]?.id ?? '';
    const trace = (
      await api().person.request('GET', `/api/dev/trace?project=${projectId}&type=record_version&id=${version}`)
    ).json<Trace>();
    expect(trace.origin.find((s) => s.type === 'proposal')?.label).toBe('definition_change proposal: Constraints');
    expect(trace.origin.some((s) => s.type === 'message' && s.label === `${DECIDED} [redefine]`)).toBe(true);
  });
});
