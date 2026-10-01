// The screen design (SCR) of a feature: accepting it creates the record based on its feature version;
// it is refused while it uses components the approved design system lacks; and with an approved design
// system, the tasks of a feature are not planned until its screens (or `no_ui`) are approved.

import { human, system } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { exportDesign } from '../src/design/export.ts';
import { recordDetail } from '../src/queries/read.ts';
import { useEnvironment } from './support/env.ts';
import { newDecision } from './support/recipes.ts';

const environment = useEnvironment();
const ana = human('ana');
const agent = system('screen-design-test');
let projectId = '';

type Cmd = Parameters<typeof executeCommand>[1]['command'];
const cmd = (command: Cmd, data: unknown, entityId?: string, actor = ana) =>
  executeCommand(environment().services, { command, actor, projectId, data, ...(entityId ? { entityId } : {}) });
const db = () => environment().services.db;

const tok = (v: unknown, type: string) => ({ $value: v, $type: type });
const curve = tok([0.2, 0, 0.38, 0.9], 'cubicBezier');
const STATES = ['default', 'hover', 'focus', 'pressed', 'disabled'];
const dsySpec = () => ({
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

async function submitAndAccept(type: string, payload: unknown) {
  const r = await cmd('batch.submit', { batch_type: 'agent', resolution: 'item', proposals: [{ type, payload }] }, undefined, agent);
  const [proposalId] = (r.result as { proposals: string[] }).proposals;
  return cmd('proposal.accept', { approve: true }, proposalId);
}

const html = (t: string) => `<main style="color: var(--text-primary)">${t}</main>`;
const screen = (id: string, steps: number[], components: string[]) => ({
  id,
  name: id,
  purpose: 'Purpose',
  steps,
  components,
  states: { empty: html('empty'), loading: html('loading'), error: html('error'), data: html('data') },
});
const scrPayload = (feature: { code: string; version: number }, spec: Record<string, unknown>) => ({
  title: 'Screens',
  sections: { Flow: prose('Flow'), Screens: prose('Screens'), States: prose('States'), Components: prose('Components') },
  spec: { feature, no_ui: null, screens: [], flow: [], ...spec },
});

async function newFeature(title: string): Promise<{ code: string; versionId: string; recordId: string }> {
  const basis = await newDecision(environment().services, projectId, true);
  const r = await cmd('record.create', {
    type: 'fdr',
    domain: 'recetas',
    title,
    sections: [
      { title: 'Goal', content: 'Share recipes.' },
      { title: 'Scope', content: 'A list and a detail.' },
      { title: 'Out of scope', content: 'Comments.' },
      { title: 'Behavior', content: '1. The person opens the list.\n2. The person picks a recipe.\n3. The person reads it.' },
    ],
    criteria: [
      { carry: 'new', title: 'List', statement: 'Given recipes, when the person opens the list, then it shows them.', verification: 'automatic', check: 'E2E.', step: 1 },
    ],
    links: [{ type: 'based_on', target: { code: basis.code, version: 1 } }],
  });
  const res = r.result as { recordId: string; versionId: string; code: string };
  await cmd('record_version.approve', {}, res.versionId);
  return res;
}

const planTasks = (versionId: string) => cmd('run.request', { action: 'task_plan', scope: { type: 'record_version', id: versionId } });

let feature: { code: string; versionId: string; recordId: string };

beforeAll(async () => {
  projectId = (await executeCommand(environment().services, { command: 'project.create', actor: ana, data: { name: 'Screens' } })).projectId;
  feature = await newFeature('Recipes');
});

describe('the screen design of a feature', () => {
  it('without an approved design system, tasks are planned as before', async () => {
    const requested = await planTasks(feature.versionId);
    expect(requested).toBeTruthy();
    // A task plan still being drafted blocks a second request for the same feature (patch ac81710):
    // the person cancels this one so the next tests can ask again.
    const queued = await db().selectFrom('ai_runs').select('state').where('id', '=', requested.entityId).executeTakeFirstOrThrow();
    if (queued.state === 'queued' || queued.state === 'running') await cmd('run.cancel', {}, requested.entityId);
  });

  it('with an approved design system, tasks are refused until the feature has approved screens', async () => {
    await submitAndAccept('design_system', {
      title: 'Design system',
      sections: Object.fromEntries(
        ['Principles', 'Visual direction', 'Tokens', 'Components', 'Patterns', 'Motion', 'Accessibility', 'Governance'].map((t) => [t, prose(t)]),
      ),
      spec: dsySpec(),
    });
    await expect(planTasks(feature.versionId)).rejects.toThrow(/no approved screen design/);
  });

  it('a screen design that leaves a step unserved is not even a proposal', async () => {
    const bad = scrPayload({ code: feature.code, version: 1 }, { screens: [screen('list', [1], ['Button'])] });
    const err = await cmd('batch.submit', { batch_type: 'agent', resolution: 'item', proposals: [{ type: 'screen_design', payload: bad }] }, undefined, agent).catch(
      (e: unknown) => e,
    );
    expect(err).toMatchObject({ type: 'guard' });
    expect(JSON.stringify(err)).toMatch(/steps 2, 3 are not served/);
  });

  it('accepting is refused, with no effect, while it uses components the design system lacks', async () => {
    const p = scrPayload({ code: feature.code, version: 1 }, { screens: [screen('list', [1, 2, 3], ['Button', 'Card', 'Table'])] });
    const err = await submitAndAccept('screen_design', p).catch((e: unknown) => e);
    expect(err).toMatchObject({ type: 'conflict', message: expect.stringMatching(/Add Card, Table to the design system first/) });
    expect(await db().selectFrom('records').select('id').where('project_id', '=', projectId).where('type', '=', 'screen_design').execute()).toHaveLength(0);
  });

  it('accepting a valid one creates SCR-… based on the feature version, and the feature page shows it', async () => {
    const p = scrPayload(
      { code: feature.code, version: 1 },
      {
        screens: [screen('list', [1], ['Button']), screen('detail', [2, 3], ['Button'])],
        flow: [{ from: 'list', to: 'detail', trigger: 'Pick a recipe', step: 2 }],
      },
    );
    const created = (await submitAndAccept('screen_design', p)).result as { code: string; version: number };
    expect(created.code).toMatch(/^SCR-[A-Z]{3}-\d{3}$/);
    expect(created.version).toBe(1);
    const scr = await recordDetail(db(), projectId, created.code);
    expect(scr).toMatchObject({ type: 'screen_design', aspect: 'product', dsy: { version: 1 }, missing_components: [] });
    expect((scr.versions[0]!.sections as { title: string }[]).map((s) => s.title)).toEqual(['Flow', 'Screens', 'States', 'Components']);
    expect(scr.versions[0]!.links).toMatchObject([{ type: 'based_on', to_code: feature.code, to_n: 1 }]);
    const fdr = await recordDetail(db(), projectId, feature.code);
    expect(fdr.screens).toMatchObject({ code: created.code, version: 1, state: 'approved', no_ui: false, screen_count: 2, missing_components: [] });
    await expect(planTasks(feature.versionId)).resolves.toBeTruthy();
    const tree = await exportDesign(db(), projectId);
    expect(tree.has(`screens/${created.code}.spec.json`)).toBe(true);
  });

  it('a feature with no interface is allowed with `no_ui`, and says why', async () => {
    const other = await newFeature('Nightly export');
    await expect(planTasks(other.versionId)).rejects.toThrow(/no approved screen design/);
    await submitAndAccept('screen_design', scrPayload({ code: other.code, version: 1 }, { no_ui: { reason: 'It is a batch job.' } }));
    const fdr = await recordDetail(db(), projectId, other.code);
    expect(fdr.screens).toMatchObject({ no_ui: true, screen_count: 0 });
    await expect(planTasks(other.versionId)).resolves.toBeTruthy();
  });
  // The design handoff: a person pastes the screens designed in Claude Design. Humans cannot submit batches,
  // so the web uses record.create / record_version.create + record_version.approve, with the same checks.
  it('a person hands off the screens they designed: refused with no effect while components are missing, then v1, then v2', async () => {
    const other = await newFeature('Handoff');
    const sections = ['Flow', 'Screens', 'States', 'Components'].map((title) => ({ title, content: prose(title) }));
    const links = [{ type: 'based_on', target: { code: other.code, version: 1 } }];
    const spec = (components: string[]) => scrPayload({ code: other.code, version: 1 }, { screens: [screen('all', [1, 2, 3], components)] }).spec;
    const scrCount = async () =>
      (await db().selectFrom('records').select('id').where('project_id', '=', projectId).where('type', '=', 'screen_design').execute()).length;
    const before = await scrCount();

    const refused = await cmd('record.create', { type: 'screen_design', domain: 'recetas', title: 'Screens', sections, spec: spec(['Button', 'Card']), links }).catch(
      (e: unknown) => e,
    );
    expect(refused).toMatchObject({ type: 'conflict', message: expect.stringMatching(/Add Card to the design system first/) });
    expect(await scrCount()).toBe(before);

    const unserved = await cmd('record.create', {
      type: 'screen_design',
      domain: 'recetas',
      title: 'Screens',
      sections,
      spec: scrPayload({ code: other.code, version: 1 }, { screens: [screen('all', [1], ['Button'])] }).spec,
      links,
    }).catch((e: unknown) => e);
    expect(unserved).toMatchObject({ type: 'validation', message: expect.stringMatching(/steps 2, 3 are not served/) });
    expect(await scrCount()).toBe(before);

    const first = (await cmd('record.create', { type: 'screen_design', domain: 'recetas', title: 'Screens', sections, spec: spec(['Button']), links })).result as {
      code: string;
      recordId: string;
      versionId: string;
    };
    await cmd('record_version.approve', {}, first.versionId);
    expect(await recordDetail(db(), projectId, other.code)).toMatchObject({ screens: { code: first.code, version: 1, state: 'approved', screen_count: 1 } });

    const second = (
      await cmd('record_version.create', { record_id: first.recordId, title: 'Screens', sections, spec: spec(['Button']), links, change_note: 'Pasted again.' })
    ).result as { versionId: string; version: number };
    await cmd('record_version.approve', {}, second.versionId);
    expect(second.version).toBe(2);
    expect(await recordDetail(db(), projectId, other.code)).toMatchObject({ screens: { code: first.code, version: 2, state: 'approved' } });
  });
  // H50: a record_change edits sections only; the machine-readable spec is carried over from the version it changes.
  it('a change to one section of an approved screen design keeps its spec in the new version', async () => {
    const other = await newFeature('Change one section');
    const p = scrPayload({ code: other.code, version: 1 }, { screens: [screen('all', [1, 2, 3], ['Button'])] });
    const created = (await submitAndAccept('screen_design', p)).result as { code: string; recordId: string };
    const thread = (await cmd('exploration.open', { purpose: 'Review the screens' })).entityId;
    const message = (await cmd('message.post', { exploration_id: thread, text: 'List the components used on each screen.', respond: false })).entityId;
    const batch = await cmd(
      'batch.submit',
      {
        summary: 'From the thread.',
        batch_type: 'agent',
        resolution: 'item',
        proposals: [
          {
            type: 'record_change',
            payload: {
              record: { code: created.code, version: 1 },
              section: 'Components',
              content: prose('Button on every screen'),
              reason: 'Say which components each screen uses.',
              evidence: [{ message_id: message, quote: 'List the components used' }],
            },
          },
        ],
      },
      undefined,
      system('exploration'),
    );
    const proposal = await db().selectFrom('proposals').select('id').where('batch_id', '=', batch.entityId).executeTakeFirstOrThrow();
    const r = await cmd('proposal.accept', { approve: true }, proposal.id);
    expect(r.result).toMatchObject({ type: 'record', code: created.code, version: 2, approved: true });
    const versions = await db().selectFrom('record_versions').select(['n', 'spec', 'sections']).where('record_id', '=', created.recordId).orderBy('n').execute();
    expect(versions).toHaveLength(2);
    expect(versions[1]!.spec).toEqual(versions[0]!.spec);
    expect(versions[1]!.spec).toMatchObject({ feature: { code: other.code, version: 1 } });
    expect((versions[1]!.sections as { title: string; content: string }[]).find((x) => x.title === 'Components')?.content).toBe(prose('Button on every screen'));
    expect((versions[0]!.sections as { title: string; content: string }[]).find((x) => x.title === 'Components')?.content).toBe(prose('Components'));
  });
});
