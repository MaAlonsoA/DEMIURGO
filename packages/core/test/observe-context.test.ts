// The context manifest (spec §9, §16): the explorer's builder records every candidate it weighed
// (messages beyond the limit or the budget, a decision cut at 400 characters, sources beyond five
// or cut at 2000, knowledge below the threshold) with its origin, what it did with it and why; what
// entered respects each section's budget and takes consecutive positions; `run.request` emits the
// manifest as the `demiurgo.context.manifest` note with the pack's hash, and a pack that already
// existed is marked as reused.

import { randomUUID } from 'node:crypto';
import { ATTR, type Fragment, LOG, type Manifest, human } from '@demiurgo/domain';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { type Built, buildContext } from '../src/context/build.ts';
import { graphVersion } from '../src/context/graph.ts';
import type { ReadableLogRecord } from '../src/observe/core.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment();
const ana = human('ana');
const BUDGET = { messages: 12_000, decisions: 4_000, sources: 6_000, knowledge: 4_000 };
const MESSAGE_CHARS = 300;
const DECISION_TITLE = 'Membership fee of the partners';
const DECISION_TEXT = 'The partners pay a yearly membership fee to the association. '.repeat(12);
const SOURCE_TEXT = 'Membership fee source text. '.repeat(100);

let projectId = '';
let thread = '';
let recordId = '';
let messageIds: string[] = [];
let sourceIds: string[] = [];
let built: Built;

const cmd = (command: Parameters<typeof executeCommand>[1]['command'], data: unknown, entityId?: string) =>
  executeCommand(environment().services, { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });

const messageBody = (i: number) => `Message ${i} about the membership fee. `.padEnd(MESSAGE_CHARS, 'fee ');

const bySection = (m: Manifest, section: string): Fragment[] => m.fragments.filter((f) => f.section === section);
const entered = (fragments: Fragment[]): Fragment[] => fragments.filter((f) => f.decision !== 'dropped');

const manifestLogs = (): ReadableLogRecord[] =>
  environment()
    .observer.logs()
    .filter((l) => l.eventName === LOG.contextManifest);

/** Runs `fn` as an API interaction of Ana's, like the API route does. */
function interaction<T>(command: string, fn: () => Promise<T>): Promise<T> {
  return environment().observer.interaction({ channel: 'api', actor: 'human:ana', actorType: 'human', command, projectId }, fn);
}

beforeAll(async () => {
  const s = environment().services;
  projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Manifests' } })).projectId;
  thread = (await cmd('exploration.open', { purpose: 'Membership fee policy for the partners' })).entityId;
  for (let i = 1; i <= 65; i++) {
    const r = await cmd('message.post', { exploration_id: thread, text: messageBody(i), respond: false });
    messageIds.push(r.entityId);
  }
  const d = (
    await cmd('record.create', {
      type: 'decision',
      domain: 'fees',
      title: DECISION_TITLE,
      sections: [
        { title: 'Context', content: 'The association needs income.' },
        { title: 'Decision', content: DECISION_TEXT },
        { title: 'Consequences', content: 'A receipt is issued.' },
      ],
    })
  ).result as { recordId: string; versionId: string; code: string };
  recordId = d.recordId;
  await cmd('record_version.approve', {}, d.versionId);
  for (let i = 1; i <= 6; i++) {
    const r = await cmd('source.register', { name: `Source ${i}`, content: SOURCE_TEXT });
    sourceIds.push(r.entityId);
  }
  // A confirmed node that shares no word with the thread: below the threshold.
  await sql`insert into knowledge_nodes (project_id, ref, kind, source_type, source_id, source_version, label, body, epistemic, valid_from, state)
    values (${projectId}::uuid, 'DEC-ZZZ-001@1', 'decision', 'record_version', ${randomUUID()}::uuid, 1,
            'Zoology', 'Giraffes elephants zebras.', 'confirmed', 1, 'current')`.execute(s.db);
  built = await s.db
    .transaction()
    .execute(async (trx) =>
      buildContext(
        trx,
        projectId,
        'exploration_chat',
        { type: 'exploration', id: thread },
        {},
        await graphVersion(trx, projectId),
      ),
    );
});

describe('what the explorer builder records', () => {
  it('names itself with its version, the graph version and the budget, and counts every candidate', () => {
    const { pack, manifest } = built;
    expect(manifest.builder).toBe('exploration_chat@2');
    expect(pack.constructor).toBe('exploration_chat@2');
    expect(manifest.graphVersion).toBe(pack.graph_version);
    expect(manifest.budget).toEqual(BUDGET);
    expect(manifest.candidates).toBe(manifest.fragments.length);
    expect(manifest.fragments.map((f) => f.seq)).toEqual(manifest.fragments.map((_, i) => i + 1));
  });

  it('messages: the newest within the budget enter with the seq of their message.post event; the rest fall by budget or by the limit of 60', async () => {
    const messages = bySection(built.manifest, 'messages');
    expect(messages).toHaveLength(65);
    const included = entered(messages);
    expect(included).toHaveLength(Math.floor(BUDGET.messages / MESSAGE_CHARS));
    for (const f of included) expect(f).toMatchObject({ decision: 'included', reason: 'recent', chars: MESSAGE_CHARS });
    // Chronological in the pack: the newest 40 messages, oldest first.
    expect(included.map((f) => f.source.id)).toEqual(messageIds.slice(25));
    expect(
      messages
        .filter((f) => f.reason === 'budget:messages')
        .map((f) => f.source.id)
        .sort(),
    ).toEqual(messageIds.slice(5, 25).sort());
    expect(
      messages
        .filter((f) => f.reason === 'limit:60')
        .map((f) => f.source.id)
        .sort(),
    ).toEqual(messageIds.slice(0, 5).sort());
    const events = await environment()
      .services.db.selectFrom('events')
      .select(['entity_id', 'seq'])
      .where('project_id', '=', projectId)
      .where('command', '=', 'message.post')
      .execute();
    const seqOf = new Map(events.map((e) => [e.entity_id, Number(e.seq)]));
    for (const f of messages) {
      expect(f.source).toMatchObject({ type: 'message', version: null, eventSeq: seqOf.get(f.source.id) });
      expect(f.source.eventSeq).toBeGreaterThan(0);
    }
    const chars = included.reduce((acc, f) => acc + f.chars, 0);
    expect(chars).toBeLessThanOrEqual(BUDGET.messages);
    expect(chars + MESSAGE_CHARS).toBeGreaterThan(BUDGET.messages);
  });

  it('a decision longer than 400 characters enters truncated, with its record and version', () => {
    const decisions = bySection(built.manifest, 'decisions');
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      decision: 'truncated',
      reason: 'excerpt:400',
      chars: DECISION_TITLE.length + 400,
      originalChars: DECISION_TITLE.length + DECISION_TEXT.length,
      source: { type: 'record', id: recordId, version: 1, eventSeq: null },
    });
    expect(built.pack.dependencies).toContainEqual({ type: 'record', id: recordId, version: 1 });
  });

  it('sources: five are weighed, cut at 2000 characters, three fit the budget, and the sixth falls by the limit', () => {
    const sources = bySection(built.manifest, 'sources');
    expect(sources).toHaveLength(6);
    const truncated = sources.filter((f) => f.decision === 'truncated');
    expect(truncated).toHaveLength(Math.floor(BUDGET.sources / 2000));
    for (const f of truncated)
      expect(f).toMatchObject({ reason: 'excerpt:2000', chars: 2000, originalChars: SOURCE_TEXT.length });
    expect(sources.filter((f) => f.reason === 'budget:sources')).toHaveLength(2);
    const beyond = sources.filter((f) => f.reason === 'limit:5');
    expect(beyond.map((f) => f.source.id)).toEqual([sourceIds[0]]);
    expect(beyond[0]).toMatchObject({ decision: 'dropped', source: { type: 'source', version: null } });
  });

  it('knowledge: the relevant node enters with its score and graph version; the unrelated one is below the threshold', () => {
    const knowledge = bySection(built.manifest, 'knowledge');
    const relevant = knowledge.filter((f) => f.decision !== 'dropped');
    expect(relevant.length).toBeGreaterThan(0);
    for (const f of relevant) {
      expect(f.reason).toMatch(/^relevance:\d\.\d\d$/);
      expect(f.score).toBeGreaterThan(0);
      expect(f.reason).toBe(`relevance:${f.score?.toFixed(2)}`);
      expect(f.source).toMatchObject({ type: 'knowledge_node', version: built.manifest.graphVersion, eventSeq: null });
    }
    const zoology = knowledge.find((f) => f.source.id === 'DEC-ZZZ-001@1');
    expect(zoology).toMatchObject({ decision: 'dropped', reason: 'below_threshold', score: 0, position: null });
    // The pack carries exactly the nodes that entered, in the same order.
    const packRefs = (built.pack.content as { knowledge: { ref: string }[] }).knowledge.map((n) => n.ref);
    expect(relevant.map((f) => f.source.id)).toEqual(packRefs);
  });

  it('the purpose, the questions and the thread itself are fragments too, with the exploration as origin', () => {
    expect(bySection(built.manifest, 'purpose')).toEqual([
      expect.objectContaining({
        decision: 'included',
        reason: 'scope',
        source: { type: 'exploration', id: thread, version: null, eventSeq: null },
      }),
    ]);
  });

  it('what entered stays within each section budget, and takes consecutive positions in pack order', () => {
    const { manifest } = built;
    const filled = Object.keys(manifest.budget).map((section) => ({
      section,
      chars: entered(bySection(manifest, section)).reduce((acc, f) => acc + f.chars, 0),
      budget: manifest.budget[section] ?? 0,
    }));
    expect(filled.map((s) => s.section).sort()).toEqual(['decisions', 'knowledge', 'messages', 'sources']);
    expect(filled.filter((s) => s.chars > s.budget)).toEqual([]);
    expect(filled.filter((s) => s.chars === 0)).toEqual([]);
    const positions = entered(manifest.fragments).map((f) => f.position);
    expect(positions).toEqual(positions.map((_, i) => i));
    for (const f of manifest.fragments) {
      expect(f.position === null).toBe(f.decision === 'dropped');
      expect(f.textHash).toMatch(/^[0-9a-f]{64}$/);
      expect(f.originalChars).toBeGreaterThanOrEqual(f.chars);
    }
  });
});

describe('the demiurgo.context.manifest note', () => {
  it('run.request emits the manifest with the pack hash, id, builder, role, graph version and budget, inside the interaction', async () => {
    environment().observer.reset();
    const r = await interaction('run.request', () =>
      cmd('run.request', { action: 'exploration_chat', scope: { type: 'exploration', id: thread } }),
    );
    const result = r.result as { contextPackId: string; contextPackHash: string };
    const notes = manifestLogs();
    expect(notes).toHaveLength(1);
    const note = notes[0] as ReadableLogRecord;
    expect(note.attributes).toMatchObject({
      [ATTR.packHash]: result.contextPackHash,
      [ATTR.packId]: result.contextPackId,
      [ATTR.packBuilder]: 'exploration_chat@2',
      [ATTR.packRole]: 'explore',
      [ATTR.graphVersion]: built.manifest.graphVersion,
      [ATTR.packBudget]: JSON.stringify(BUDGET),
      [ATTR.projectId]: projectId,
      [ATTR.runId]: r.entityId,
    });
    expect(note.attributes[ATTR.packReused]).toBeUndefined();
    const body = JSON.parse(typeof note.body === 'string' ? note.body : '{}') as Manifest;
    expect(body.builder).toBe('exploration_chat@2');
    expect(body.candidates).toBe(body.fragments.length);
    expect(body.fragments.filter((f) => f.section === 'messages').length).toBeGreaterThanOrEqual(65);
    // The manifest is not in the operational base: the pack row carries only what the hash covers.
    const pack = await environment()
      .services.db.selectFrom('context_packs')
      .selectAll()
      .where('id', '=', result.contextPackId)
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(pack)).not.toContain('textHash');
    expect(pack.builder).toBe('exploration_chat@2');
  });

  it('a second identical request marks the pack as reused', async () => {
    environment().observer.reset();
    const input = { text: 'the same text twice' };
    const first = await interaction('run.request', () => cmd('run.request', { action: 'echo', scope: { type: 'echo' }, input }));
    const second = await interaction('run.request', () => cmd('run.request', { action: 'echo', scope: { type: 'echo' }, input }));
    const notes = manifestLogs();
    expect(notes).toHaveLength(2);
    expect(notes[0]?.attributes[ATTR.packReused]).toBeUndefined();
    expect(notes[1]?.attributes).toMatchObject({
      [ATTR.packReused]: true,
      [ATTR.packBuilder]: 'echo@1',
      [ATTR.packRole]: 'echo',
    });
    expect(notes[0]?.attributes[ATTR.packHash]).toBe(notes[1]?.attributes[ATTR.packHash]);
    expect((first.result as { contextPackId: string }).contextPackId).toBe(
      (second.result as { contextPackId: string }).contextPackId,
    );
  });
});
