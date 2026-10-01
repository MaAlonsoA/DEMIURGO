import { describe, expect, it } from 'vitest';
import { inceptionPath, nextStepNeed, type InceptionInput } from '../../../domain/src/inception.ts';
import type { Inbox, InboxBatch, InboxProposal } from '../../src/api/types.ts';
import { catchUpOrder, needsCount, needsOf } from '../../src/screens/needs-you/order.ts';
import { needReason } from '../../src/screens/needs-you/titles.ts';
import { orderedChanges } from '../../src/screens/overview/definition.ts';

const proposal = (id: string, ordinal?: number): InboxProposal => ({
  id,
  type: 'design_record',
  payload: { title: id },
  state: 'pending',
  ...(ordinal !== undefined ? { ordinal } : {}),
  epistemic_status: 'proposed',
  obsolescence: [],
  assessment: null,
  dependencies: [],
});

const batch = (id: string, resolution: string, proposals: InboxProposal[], size?: number): InboxBatch => ({
  id,
  type: 'agent',
  producer: 'agent:run:r1',
  resolution,
  summary: null,
  run_id: null,
  created: '2026-10-01T10:00:00Z',
  ...(size !== undefined ? { size } : {}),
  dependencies: [],
  proposals,
});

const empty = (batches: InboxBatch[], extra: Partial<Inbox> = {}): Inbox => ({
  total: 0,
  batches,
  questions_to_confirm: [],
  open_questions: [],
  versions_to_approve: [],
  links_under_review: [],
  classifications_to_review: [],
  rejected_updates: [],
  ...extra,
});

const reasonCtx = { rows: [], threads: [] };

describe('Needs you counts and positions', () => {
  it('the count is the number of things listed: a package is one, whatever it holds', () => {
    const inbox = empty([batch('b1', 'item', [proposal('a'), proposal('b')]), batch('pkg', 'package', ['c', 'd', 'e'].map((id) => proposal(id)))]);
    expect(needsCount(inbox)).toBe(3);
    expect(needsCount(inbox)).toBe(needsOf(inbox, []).length);
  });

  it('«n of N» is the place in the whole batch: it does not shrink as proposals are decided', () => {
    // A batch of 6 with the first four already decided: the two left are 5 of 6 and 6 of 6.
    const inbox = empty([batch('b', 'item', [proposal('p5', 5), proposal('p6', 6)], 6)]);
    const items = needsOf(inbox, []);
    expect(items.map((i) => needReason(i, reasonCtx).replace(/^.*· /, ''))).toEqual(['5 of 6', '6 of 6']);
  });

  it('without the server fields it falls back to the position among the pending ones', () => {
    const items = needsOf(empty([batch('b', 'item', [proposal('p1'), proposal('p2')])]), []);
    expect(items.map((i) => (i.kind === 'proposal' ? [i.position, i.of] : null))).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('the onboarding step waiting on the person is one more thing, first in the list and in Catch up', () => {
    const inbox = empty([batch('b', 'item', [proposal('p1')])], {
      next_step: { key: 'design_system', title: 'Design system', action: 'design_system', code: null },
    });
    expect(needsCount(inbox)).toBe(2);
    expect(needsOf(inbox, [])[0]?.kind).toBe('next_step');
    expect(catchUpOrder(needsOf(inbox, []))[0]?.kind).toBe('next_step');
  });
});

const stage = (key: string, state: string, extra: Partial<InceptionInput['stages'][number]> = {}) => ({
  key,
  id: `id-${key}`,
  state,
  thread: `t-${key}`,
  uncovered: 0,
  ...extra,
});

const input = (over: Partial<InceptionInput>): InceptionInput => ({
  hasInterface: true,
  stages: [],
  definition: null,
  definitionProposal: false,
  pending: [],
  designSystemThread: null,
  capabilityThreads: [],
  approvedDecisions: 0,
  designSystem: null,
  epics: [],
  features: [],
  firstFeature: null,
  repository: false,
  builtTasks: 0,
  nextTask: null,
  ...over,
});

describe('The onboarding step as a thing for the person', () => {
  it('a step is not done while its own stage still has open questions', () => {
    const path = inceptionPath(
      input({ definition: { code: 'DEF-1', approved: true }, stages: [stage('requirements', 'passed', { open: 2 })] }),
    );
    const first = path.steps[0];
    expect(first?.state).toBe('current');
    expect(first?.action).toMatchObject({ kind: 'answer_stage', stage: 'requirements' });
    const closed = inceptionPath(
      input({ definition: { code: 'DEF-1', approved: true }, stages: [stage('requirements', 'passed', { open: 0 })] }),
    );
    expect(closed.steps[0]?.state).toBe('done');
  });

  it('a step the person must act on is offered; proposals, drafts and DEMIURGO at work are not', () => {
    const designSystem = inceptionPath(
      input({
        definition: { code: 'DEF-1', approved: true },
        stages: [stage('requirements', 'passed'), stage('quality', 'passed'), stage('principles', 'passed')],
      }),
    );
    expect(nextStepNeed(designSystem, 0)).toMatchObject({ key: 'design_system', action: 'design_system' });
    const working = inceptionPath(
      input({
        definition: { code: 'DEF-1', approved: true },
        stages: [stage('requirements', 'passed'), stage('quality', 'passed'), stage('principles', 'passed')],
        designSystemThread: 't-ds',
      }),
    );
    expect(nextStepNeed(working, 0, ['t-ds'])).toBeNull();
    const proposed = inceptionPath(input({ definitionProposal: true, definition: { code: 'DEF-1', approved: false } }));
    expect(nextStepNeed(proposed, 0)).toBeNull();
  });

  it('after a rejection the thread is the person\'s turn unless DEMIURGO is working in it', () => {
    const passed = [stage('requirements', 'passed'), stage('quality', 'passed'), stage('principles', 'passed')];
    const def = { code: 'DEF-1', approved: true };
    // Design system proposal rejected: no draft, no pending, its thread is still active.
    const rejected = inceptionPath(input({ definition: def, stages: passed, designSystemThread: 't-ds' }));
    expect(nextStepNeed(rejected, 0)).toMatchObject({ key: 'design_system', action: 'thread' });
    expect(nextStepNeed(rejected, 0, ['t-other'])).toMatchObject({ action: 'thread' });
    expect(nextStepNeed(rejected, 0, ['t-ds'])).toBeNull();
    // Epics map rejected: the capability thread is open again.
    const ds = { code: 'DS-1', approved: true };
    const epics = inceptionPath(input({ definition: def, stages: passed, designSystem: ds, capabilityThreads: ['t-cap'] }));
    expect(nextStepNeed(epics, 0)).toMatchObject({ key: 'backlog', action: 'thread' });
    expect(nextStepNeed(epics, 0, ['t-cap'])).toBeNull();
    // Nothing in a thread: map the first version.
    const none = inceptionPath(input({ definition: def, stages: passed, designSystem: ds }));
    expect(nextStepNeed(none, 0)).toMatchObject({ key: 'backlog', action: 'plan_backlog' });
    // Feature draft rejected: the approved epic has no feature left to approve.
    const feature = inceptionPath(
      input({ definition: def, stages: passed, designSystem: ds, epics: [{ code: 'EPC-1', approved: true }] }),
    );
    expect(nextStepNeed(feature, 0)).toMatchObject({ key: 'first_feature', action: 'epics' });
    // Screens rejected / task plan rejected: back to the feature to ask again.
    const base = {
      definition: def,
      stages: [...passed, stage('architecture', 'passed'), stage('security', 'passed')],
      designSystem: ds,
      epics: [{ code: 'EPC-1', approved: true }],
      features: [{ code: 'FDR-1', approved: true }],
      approvedDecisions: 1,
    };
    const screens = inceptionPath(input({ ...base, firstFeature: { code: 'FDR-1', screens: null, tasks: [] } }));
    expect(nextStepNeed(screens, 0)).toMatchObject({ key: 'screens', action: 'feature', code: 'FDR-1' });
    const tasks = inceptionPath(
      input({ ...base, firstFeature: { code: 'FDR-1', screens: { code: 'SCR-1', approved: true }, tasks: [] } }),
    );
    expect(nextStepNeed(tasks, 0)).toMatchObject({ key: 'tasks', action: 'feature', code: 'FDR-1' });
  });

  it('questions already listed in Needs you are not repeated as a next step', () => {
    const path = inceptionPath(input({ stages: [stage('requirements', 'open', { uncovered: 3, open: 3 })] }));
    expect(nextStepNeed(path, 3)).toBeNull();
    expect(nextStepNeed(path, 0)).toMatchObject({ action: 'answer_stage' });
  });
});

describe('Pending definition changes', () => {
  it('are listed together in the order of the definition sections', () => {
    const c = (section: string, created_at: string) => ({ section, created_at });
    const ordered = orderedChanges([
      c('First version', '2026-10-01T10:00:00Z'),
      c('Outcomes', '2026-10-01T11:00:00Z'),
      c('Purpose', '2026-10-01T12:00:00Z'),
    ]);
    expect(ordered.map((x) => x.section)).toEqual(['Purpose', 'Outcomes', 'First version']);
  });
});
