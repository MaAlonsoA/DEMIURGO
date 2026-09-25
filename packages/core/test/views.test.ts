// Product views (FDR-INT-002) over the repository's own design/, imported and ratified: the map
// shows each record in the area of its domain with the relations its links declare, and each
// feature with a Behavior has a journey with its steps, paths and gaps.

import { readTree } from '@demiurgo/design';
import { human, relationOf, system } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { IMPORTER } from '../src/design/import.ts';
import { recordDetail } from '../src/queries/read.ts';
import { productJourneys, productMap } from '../src/queries/views.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment();
const ana = human('ana');
let projectId = '';

beforeAll(async () => {
  const s = environment().services;
  projectId = (await executeCommand(s, { command: 'project.create', actor: system('cli'), data: { name: 'Views' } })).projectId;
  const tree = await readTree('design');
  const imported = await executeCommand(s, {
    command: 'design.import',
    actor: IMPORTER,
    projectId,
    data: { tree: Object.fromEntries(tree), origin: 'test' },
  });
  const batchId = (imported.result as { batchId: string }).batchId;
  await executeCommand(s, { command: 'batch.accept_package', actor: ana, projectId, entityId: batchId, data: {} });
});

describe('product map', () => {
  it('AC-INT-002-01 every record is in the area of its domain, features first', async () => {
    const map = await productMap(environment().services.db, projectId);
    expect(map.records.length).toBeGreaterThan(10);
    for (const r of map.records) expect(map.areas).toContain(r.domain);
    expect(new Set(map.areas).size).toBe(map.areas.length);
    // The area with features comes before an area with only decisions.
    const withFeature = map.areas.findIndex((a) => map.records.some((r) => r.domain === a && r.type === 'fdr'));
    expect(withFeature).toBe(0);
  });

  it('AC-INT-002-02 each relation is a real link with its type, and nothing else', async () => {
    const { db } = environment().services;
    const map = await productMap(db, projectId);
    expect(map.relations.length).toBeGreaterThan(0);
    const types = new Map(map.records.map((r) => [r.code, r.type]));
    for (const rel of map.relations) {
      expect(types.has(rel.from)).toBe(true);
      expect(types.has(rel.to)).toBe(true);
      expect(relationOf(rel.link, types.get(rel.from) ?? '', types.get(rel.to) ?? '')).toBe(rel.kind);
    }
    // FDR-AGE-002 is based on ADR-AGE-001: a rule it follows.
    expect(map.relations).toContainEqual(expect.objectContaining({ from: 'FDR-AGE-002', to: 'ADR-AGE-001', kind: 'follows' }));
    const linkCount = await db
      .selectFrom('links')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('project_id', '=', projectId)
      .where('type', 'in', ['based_on', 'design_of', 'conflicts_with', 'derived_from'])
      .executeTakeFirstOrThrow();
    expect(map.relations.length).toBeLessThanOrEqual(Number(linkCount.n));
  });
});

describe('product journeys', () => {
  it('AC-INT-002-05 each feature with a Behavior has a journey: its numbered points as steps and its criteria as paths', async () => {
    const { journeys } = await productJourneys(environment().services.db, projectId);
    const age = journeys.find((j) => j.code === 'FDR-AGE-002');
    expect(age?.steps.map((s) => s.title)).toEqual([
      'Descubrimiento.',
      'Asignación.',
      'Resolución.',
      'Ejecución.',
      'Sesión.',
      'Rastro y consumo.',
      'Simulado.',
    ]);
    expect(age?.steps[0]?.detail.length).toBeGreaterThan(0);
    expect(age?.paths).toHaveLength(13);
    expect(age?.paths[0]).toMatchObject({
      code: 'AC-AGE-002-01',
      given: expect.stringContaining('tres proveedores'),
      outcome: expect.any(String),
    });
    for (const j of journeys) expect(j.steps.length).toBeGreaterThan(0);
  });
});

describe('journey gaps', () => {
  it("AC-INT-002-06 the open questions of a feature's thread are the gaps of its journey", async () => {
    const s = environment().services;
    const cmd = (command: Parameters<typeof executeCommand>[1]['command'], data: unknown, entityId?: string) =>
      executeCommand(s, { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });
    const thread = (await cmd('exploration.open', { purpose: 'Sign-ups' })).entityId;
    const open = (await cmd('question.raise', { exploration_id: thread, question: 'Is there a limit on places?' })).entityId;
    const closed = (await cmd('question.raise', { exploration_id: thread, question: 'Who can sign up?' })).entityId;
    await cmd('question.confirm', { conclusion: 'Only members.' }, closed);
    await cmd('record.create', {
      type: 'fdr',
      domain: 'signups',
      title: 'Sign up for an activity',
      sections: [
        { title: 'Goal', content: 'A member takes a place.' },
        { title: 'Scope', content: 'Signing up.' },
        { title: 'Out of scope', content: 'Paying.' },
        { title: 'Behavior', content: '1. The member opens an activity.\n2. The member signs up.' },
      ],
      criteria: [
        {
          carry: 'new',
          title: 'Signed up',
          statement: 'Given an open activity, when a member signs up, then they see "You\'re in".',
          verification: 'automatic',
          check: 'A test signs up.',
        },
      ],
      origin: { type: 'exploration', id: thread },
    });
    const { journeys } = await productJourneys(s.db, projectId);
    const j = journeys.find((x) => x.title === 'Sign up for an activity');
    expect(j?.steps.map((x) => x.title)).toEqual(['The member opens an activity.', 'The member signs up.']);
    expect(j?.paths).toEqual([
      expect.objectContaining({ given: 'an open activity', when: 'a member signs up', outcome: 'they see "You\'re in".' }),
    ]);
    expect(j?.gaps.map((g) => g.id)).toEqual([open]);
    const map = await productMap(s.db, projectId);
    expect(map.questions.find((q) => q.id === open)?.affects).toContain(
      journeys.find((x) => x.title === 'Sign up for an activity')?.code,
    );
  });
});

describe('what connects to a record', () => {
  const DECISION = [
    { title: 'Context', content: 'c' },
    { title: 'Decision', content: 'd' },
    { title: 'Consequences', content: 'k' },
  ];
  type Created = { recordId: string; code: string };

  it('AC-INT-002-08 a record lists the records whose shown version links to it, with the link type', async () => {
    const s = environment().services;
    const adr = await recordDetail(s.db, projectId, 'ADR-AGE-001');
    expect(adr.incoming).toContainEqual(
      expect.objectContaining({ from_code: 'FDR-AGE-002', from_type: 'fdr', type: 'based_on', to_n: 2, relation: 'follows' }),
    );
    expect(adr.incoming.every((l) => l.from_code !== 'ADR-AGE-001')).toBe(true);
    const plan = await recordDetail(s.db, projectId, 'DEC-PLN-001');
    expect(plan.incoming.map((l) => l.from_code)).toEqual(expect.arrayContaining(['FDR-INT-001', 'FDR-DIS-001', 'FDR-INT-002']));
  });

  it('AC-INT-002-08 a link that a newer version of the other record dropped no longer connects', async () => {
    const s = environment().services;
    const create = async (data: Record<string, unknown>) =>
      (await executeCommand(s, { command: 'record.create', actor: ana, projectId, data })).result as Created;
    const rule = await create({ type: 'decision', domain: 'links', title: 'A rule', sections: DECISION });
    const follower = await create({
      type: 'decision',
      domain: 'links',
      title: 'Follows the rule',
      sections: DECISION,
      links: [{ type: 'based_on', target: { code: rule.code, version: 1 } }],
    });
    expect((await recordDetail(s.db, projectId, rule.code)).incoming.map((l) => l.from_code)).toEqual([follower.code]);
    await executeCommand(s, {
      command: 'record_version.create',
      actor: ana,
      projectId,
      data: { record_id: follower.recordId, title: 'Follows nothing', sections: DECISION, change_note: 'Drops the rule.' },
    });
    expect((await recordDetail(s.db, projectId, rule.code)).incoming).toEqual([]);
  });
});
