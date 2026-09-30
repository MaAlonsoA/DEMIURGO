// The design system (DSY): a proposal carries prose sections plus a machine-readable spec. Accepting it
// creates the project's DSY record (one per project) or its next version; the spec is stored with the
// version and is immutable; an invalid spec never becomes a proposal.

import { human, system } from '@demiurgo/domain';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { exportDesign } from '../src/design/export.ts';
import { recordDetail } from '../src/queries/read.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment();
const ana = human('ana');
const agent = system('design-system-test');
let projectId = '';

type Cmd = Parameters<typeof executeCommand>[1]['command'];
const cmd = (command: Cmd, data: unknown, entityId?: string, actor = ana) =>
  executeCommand(environment().services, { command, actor, projectId, data, ...(entityId ? { entityId } : {}) });

const tok = (v: unknown, type: string) => ({ $value: v, $type: type });
const curve = tok([0.2, 0, 0.38, 0.9], 'cubicBezier');
const STATES = ['default', 'hover', 'focus', 'pressed', 'disabled'];

const spec = () => ({
  base: { kind: 'scratch' },
  principles: ['Sober and document-like'],
  tokens: {
    color: {
      'text-primary': tok({ light: '#111111', dark: '#f5f5f5' }, 'color'),
      'bg-app': tok({ light: '#ffffff', dark: '#101010' }, 'color'),
      'surface-panel': tok({ light: '#f4f4f4', dark: '#1a1a1a' }, 'color'),
    },
    typography: {
      family: { sans: tok('Inter, sans-serif', 'fontFamily') },
      size: { base: tok('16px', 'dimension') },
      lineHeight: { base: tok(1.5, 'number') },
    },
    space: { 1: tok('4px', 'dimension') },
    radius: { sm: tok('4px', 'dimension') },
    shadow: { sm: tok('0 1px 2px rgba(0,0,0,.2)', 'shadow') },
    motion: {
      duration: { fast: tok('100ms', 'duration'), base: tok('200ms', 'duration'), slow: tok('400ms', 'duration') },
      easing: { standard: curve, entrance: curve, exit: curve },
      scheme: 'productive',
      reduced: 'Replace movement with an instant change or a fade under 100ms.',
    },
  },
  components: [
    { name: 'Button', purpose: 'Act', interactive: true, variants: ['primary'], states: STATES, accessibility: 'Native button', specimen_html: '<button>Ok</button>' },
  ],
  patterns: [{ name: 'Form row', purpose: 'Label and input', uses: ['Button'] }],
  paths: {},
});

const prose = (t: string) => `${t}, in English prose.`;
const payload = (over: Record<string, unknown> = {}) => ({
  title: 'Design system',
  sections: {
    Principles: prose('Principles'),
    'Visual direction': prose('Visual direction'),
    Tokens: prose('Tokens'),
    Components: prose('Components'),
    Patterns: prose('Patterns'),
    Motion: prose('Motion'),
    Accessibility: prose('Accessibility'),
    Governance: prose('Governance'),
  },
  spec: spec(),
  ...over,
});

const submit = (p: unknown) =>
  cmd('batch.submit', { batch_type: 'agent', resolution: 'item', proposals: [{ type: 'design_system', payload: p }] }, undefined, agent);

async function acceptNew(p: unknown) {
  const r = await submit(p);
  const [proposalId] = (r.result as { proposals: string[] }).proposals;
  const accepted = await cmd('proposal.accept', { approve: true }, proposalId);
  return accepted.result as { code: string; version: number; versionId: string };
}

beforeAll(async () => {
  projectId = (await executeCommand(environment().services, { command: 'project.create', actor: ana, data: { name: 'DS' } })).projectId;
});

describe('the design system proposal', () => {
  it('an invalid spec is rejected and creates no proposal', async () => {
    const bad = spec();
    (bad.tokens as { shadow: unknown }).shadow = {};
    // Guard failure (409, like every invalid payload): the reason names the spec problem.
    const err = await submit(payload({ spec: bad })).catch((e: unknown) => e);
    expect(err).toMatchObject({ type: 'guard' });
    expect(JSON.stringify(err)).toMatch(/spec.*shadow/);
    const n = await environment().services.db.selectFrom('proposals').select('id').where('project_id', '=', projectId).execute();
    expect(n).toHaveLength(0);
  });

  it('accepting the first one creates DSY-… with its sections and spec', async () => {
    const created = await acceptNew(payload());
    expect(created.code).toMatch(/^DSY-[A-Z]{3}-001$/);
    expect(created.version).toBe(1);
    const d = await recordDetail(environment().services.db, projectId, created.code);
    expect(d.type).toBe('design_system');
    const v = d.versions[0]!;
    expect(v.state).toBe('approved');
    expect((v.sections as { title: string }[]).map((s) => s.title)).toEqual([
      'Principles', 'Visual direction', 'Tokens', 'Components', 'Patterns', 'Motion', 'Accessibility', 'Governance',
    ]);
    expect(v.spec).toMatchObject({ base: { kind: 'scratch' }, paths: { system: 'src/design-system/' } });
    expect(v.warnings.join(' ')).toContain('12');
  });

  it('a second accepted proposal creates version 2 of the same record', async () => {
    const second = await acceptNew(payload({ title: 'Design system v2', change_note: 'Added a card.' }));
    expect(second.version).toBe(2);
    const records = await environment().services.db.selectFrom('records').select('code').where('project_id', '=', projectId).where('type', '=', 'design_system').execute();
    expect(records).toHaveLength(1);
    expect(second.code).toBe(records[0]!.code);
  });

  it('exports the spec next to the prose', async () => {
    const tree = await exportDesign(environment().services.db, projectId);
    expect(tree.has('design-system/spec.json')).toBe(true);
    expect(JSON.parse(tree.get('design-system/spec.json')!)).toMatchObject({ base: { kind: 'scratch' } });
  });

  it('the spec of a version is immutable', async () => {
    const row = await environment().services.db.selectFrom('record_versions').select('id').where('project_id', '=', projectId).where('n', '=', 1).executeTakeFirstOrThrow();
    await expect(sql`update record_versions set spec = '{}'::jsonb where id = ${row.id}::uuid`.execute(environment().services.db)).rejects.toThrow(/immutable/);
  });
});
