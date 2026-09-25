// Invariant of the context manifest (spec §9.2, §16): every registered builder returns a manifest
// next to its pack, the manifest names the builder with its version and counts every candidate, and
// what entered each section stays within the budget the pack declares for it.

import { AGENT_ACTIONS, type AgentAction, FRAGMENT_DECISIONS, human } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../../src/bus/bus.ts';
import { BUILDERS, type Built, type Scope, buildContext } from '../../src/context/build.ts';
import { graphVersion } from '../../src/context/graph.ts';
import '../../src/commands/index.ts';
import { useEnvironment } from '../support/env.ts';

const environment = useEnvironment();
const ana = human('ana');
let projectId = '';
/** The scope and input each builder is exercised with, on the seeded project. A new builder needs its entry. */
const cases: Partial<Record<AgentAction, { scope: Scope; input: Record<string, unknown> }>> = {};

const cmd = (command: Parameters<typeof executeCommand>[1]['command'], data: unknown, entityId?: string) =>
  executeCommand(environment().services, { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });

async function approvedDecision(title: string, text: string): Promise<string> {
  const r = await cmd('record.create', {
    type: 'decision',
    domain: 'fees',
    title,
    sections: [
      { title: 'Context', content: 'The association needs income. '.repeat(120) },
      { title: 'Decision', content: text },
      { title: 'Consequences', content: 'A receipt is issued. '.repeat(120) },
    ],
  });
  const { versionId } = r.result as { versionId: string };
  await cmd('record_version.approve', {}, versionId);
  return versionId;
}

beforeAll(async () => {
  const s = environment().services;
  projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Builders' } })).projectId;
  const thread = (await cmd('exploration.open', { purpose: 'Membership fee policy for the partners' })).entityId;
  for (let i = 1; i <= 8; i++) {
    await cmd('message.post', {
      exploration_id: thread,
      text: `Message ${i} about the membership fee. `.repeat(40),
      respond: false,
    });
  }
  await cmd('question.raise', { exploration_id: thread, question: 'Who pays the membership fee?' });
  const version = await approvedDecision(
    'Membership fee of the partners',
    'The partners pay a yearly membership fee. '.repeat(100),
  );
  await approvedDecision('Membership fee receipt', 'The membership fee is collected with a receipt. '.repeat(80));
  for (let i = 1; i <= 3; i++)
    await cmd('source.register', { name: `Source ${i}`, content: 'Membership fee source text. '.repeat(120) });
  cases.echo = { scope: { type: 'echo' }, input: { text: 'x'.repeat(5000) } };
  cases.exploration_chat = { scope: { type: 'exploration', id: thread }, input: {} };
  cases.design_proposal = { scope: { type: 'record_version', id: version }, input: {} };
});

async function build(action: AgentAction): Promise<Built> {
  const c = cases[action];
  if (!c) throw new Error(`No scope for the builder of "${action}": add it to this invariant.`);
  return environment()
    .services.db.transaction()
    .execute(async (trx) => buildContext(trx, projectId, action, c.scope, c.input, await graphVersion(trx, projectId)));
}

describe('every registered builder returns a manifest and respects its budgets', () => {
  it('every agent action has a builder', () => {
    expect(Object.keys(BUILDERS).sort()).toEqual([...AGENT_ACTIONS].sort());
  });

  for (const action of AGENT_ACTIONS) {
    it(`${action}: the manifest names the builder, counts every candidate and keeps each section within budget`, async () => {
      const { pack, manifest } = await build(action);
      expect(manifest.builder).toMatch(/^[a-z_]+@\d+$/);
      expect(manifest.builder).toBe(pack.constructor);
      expect(manifest.graphVersion).toBe(pack.graph_version);
      expect(manifest.budget).toEqual(pack.budget);
      expect(manifest.fragments.length).toBeGreaterThan(0);
      expect(manifest.candidates).toBe(manifest.fragments.length);
      expect(manifest.fragments.map((f) => f.seq)).toEqual(manifest.fragments.map((_, i) => i + 1));
      for (const f of manifest.fragments) {
        expect(FRAGMENT_DECISIONS).toContain(f.decision);
        expect(f.reason).not.toBe('');
        expect(f.textHash).toMatch(/^[0-9a-f]{64}$/);
        expect(f.chars).toBeLessThanOrEqual(f.originalChars);
        expect(f.source.type).not.toBe('');
        expect(f.position === null).toBe(f.decision === 'dropped');
      }
      // A cut fragment was really cut.
      expect(manifest.fragments.filter((f) => f.decision === 'truncated' && f.originalChars <= f.chars)).toEqual([]);
      const positions = manifest.fragments.filter((f) => f.decision !== 'dropped').map((f) => f.position);
      expect(positions).toEqual(positions.map((_, i) => i));
      const filled: Record<string, number> = {};
      for (const f of manifest.fragments) if (f.decision !== 'dropped') filled[f.section] = (filled[f.section] ?? 0) + f.chars;
      const keys = Object.keys(manifest.budget);
      const budgeted = keys.filter((section) => section in filled);
      // Each budget bounds its section; a single budget that names no section (echo's
      // `characters`) bounds the whole pack.
      const limits =
        budgeted.length === 0 && keys.length === 1
          ? [
              {
                name: keys[0] ?? '',
                used: Object.values(filled).reduce((acc, n) => acc + n, 0),
                max: manifest.budget[keys[0] ?? ''] ?? 0,
              },
            ]
          : budgeted.map((section) => ({ name: section, used: filled[section] ?? 0, max: manifest.budget[section] ?? 0 }));
      expect(limits.length).toBeGreaterThan(0);
      expect(limits.filter((l) => l.used > l.max)).toEqual([]);
    });
  }
});
