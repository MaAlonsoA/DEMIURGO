import type { ExplorationDetail } from '../../src/api/types.ts';
import { createDecision, createFeature, readinessOf, recordOf } from './record-setup.ts';
import { expect, expectAccessible, test } from './support/fixtures.ts';

const SECTIONS = [
  { title: 'Context', content: 'Members bring friends to open activities.' },
  { title: 'Decision', content: 'Guests are allowed.' },
  { title: 'Consequences', content: 'Invitations are counted per activity.' },
];

test('AC-INT-001-05 approving a draft makes it current without a new version, and an earlier draft only offers Discard', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Approve a draft');
  const dec = await createDecision(person, projectId, 'Guests are allowed');
  await page.goto(`/p/${projectId}/records/${dec.code}`);
  const header = page.locator('[data-record-header]');
  await expect(page.getByRole('heading', { level: 1, name: 'Guests are allowed' })).toBeVisible();
  await expect(header.locator('[data-status] [data-mark]')).toHaveAttribute('data-mark', 'proposed');
  await expect(header).toContainText('Draft');
  await expectAccessible(page, 'a record with a draft');

  await page.getByRole('button', { name: 'Approve' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Approving does not create a new version');
  await confirm.getByRole('button', { name: 'Approve' }).click();
  await expect(confirm).toBeHidden();

  await expect(header.locator('[data-status] [data-mark]')).toHaveAttribute('data-mark', 'confirmed');
  await expect(header).toContainText('Approved');
  const versions = page.getByRole('region', { name: 'Versions' });
  await expect(versions.locator('[data-version]')).toHaveCount(1);
  await expect(versions.locator('[data-version="1"]')).toContainText('current');
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  const after = await recordOf(person, projectId, dec.code);
  expect(after.versions.map((v) => [v.n, v.state])).toEqual([[1, 'approved']]);
  expect(after.current).toBe(1);

  // v2 stays a draft while v3 is approved: v2 is now earlier than the current version.
  const v2 = await person.command(projectId, 'record_version.create', {
    record_id: dec.recordId,
    title: 'Guests are allowed',
    sections: SECTIONS,
    change_note: 'Two guests at most.',
  });
  const v3 = await person.command(projectId, 'record_version.create', {
    record_id: dec.recordId,
    title: 'Guests are allowed',
    sections: SECTIONS,
    change_note: 'Three guests at most.',
  });
  await person.command(projectId, 'record_version.approve', {}, v3.entity_id);

  await page.goto(`/p/${projectId}/records/${dec.code}?v=2`);
  await expect(header).toContainText('Draft');
  const actions = page.locator('[data-record-actions]');
  await expect(actions.getByRole('button', { name: 'Discard' })).toBeVisible();
  await expect(actions.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(actions.getByRole('link', { name: 'New version' })).toHaveCount(0);
  await expect(page.getByText('Version 2 is a draft earlier than the current one (v3): it can only be discarded.')).toBeVisible();

  // Each version with its mark: Draft ○, Approved ●, Replaced, and Discarded ⊘ once discarded.
  await expect(versions.locator('[data-version="3"] [data-mark]').first()).toHaveAttribute('data-mark', 'confirmed');
  await expect(versions.locator('[data-version="1"] [data-mark]').first()).toHaveAttribute('data-mark', 'replaced');
  await expect(versions.locator('[data-version="2"] [data-mark]').first()).toHaveAttribute('data-mark', 'proposed');
  await actions.getByRole('button', { name: 'Discard' }).click();
  const discard = page.getByRole('dialog');
  await discard.getByLabel(/Reason/).fill('Replaced by v3.');
  await discard.getByRole('button', { name: 'Discard' }).click();
  await expect(discard).toBeHidden();
  await expect(versions.locator('[data-version="2"] [data-mark]').first()).toHaveAttribute('data-mark', 'dropped');
  await expect(header).toContainText('Discarded');
  const last = await recordOf(person, projectId, dec.code);
  expect(last.versions.map((v) => [v.n, v.state])).toEqual([
    [1, 'superseded'],
    [2, 'discarded'],
    [3, 'approved'],
  ]);
  expect(v2.entity_id).not.toBe(v3.entity_id);
});

test('AC-INT-001-08 a version with readiness reasons shows each one as the server gives it and never "Ready to build"', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Readiness reasons');
  const dec = await createDecision(person, projectId, 'Guests are allowed');
  // The thread the feature comes from: one question assumed by DEMIURGO, one parked and one open.
  const thread = await person.command(projectId, 'exploration.open', { purpose: 'Guest passes for open activities' });
  const q1 = await person.command(projectId, 'question.raise', {
    exploration_id: thread.entity_id,
    question: 'How many guests?',
  });
  const q2 = await person.command(projectId, 'question.raise', { exploration_id: thread.entity_id, question: 'Do guests pay?' });
  await person.command(projectId, 'question.postpone', { reason: 'After the pilot.' }, q2.entity_id);
  await person.command(projectId, 'message.post', { exploration_id: thread.entity_id, text: "Let's go with two guests." });
  await person.until<ExplorationDetail>(
    `/api/projects/${projectId}/explorations/${thread.entity_id}`,
    (e) => e.questions.some((q) => q.id === q1.entity_id && q.state === 'inferred'),
    60_000,
  );
  await person.command(projectId, 'question.raise', { exploration_id: thread.entity_id, question: 'Can a guest come twice?' });
  const fdr = await createFeature(person, projectId, 'Guest passes', {
    basedOn: { code: dec.code, version: 1 },
    origin: { type: 'exploration', id: thread.entity_id },
  });
  const agent = await person.agent(projectId);
  await agent.command('batch.submit', {
    summary: 'A limit per guest',
    dependencies: [{ type: 'record', id: fdr.recordId, code: fdr.code, version: 1 }],
    proposals: [{ type: 'exploration', payload: { purpose: 'A limit of visits per guest' } }],
  });
  const bare = await createFeature(person, projectId, 'Bring a friend', { criteria: [] });

  for (const f of [fdr, bare]) {
    const readiness = await readinessOf(person, projectId, f.versionId);
    expect(readiness.reasons.length).toBeGreaterThan(0);
    await page.goto(`/p/${projectId}/records/${f.code}`);
    const panel = page.getByRole('region', { name: 'Before it can be built' });
    await expect(panel).toBeVisible();
    const shown = panel.locator('[data-readiness-reasons] li');
    await expect(shown).toHaveText(readiness.reasons);
    await expect(page.getByText('Ready to build', { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-record-header] [data-stage]')).toHaveAttribute('data-stage', 'not-ready');
  }
  const reasons = (await readinessOf(person, projectId, fdr.versionId)).reasons;
  expect(reasons).toEqual(
    expect.arrayContaining([
      'Version 1 is not approved.',
      `The decision it is based on, ${dec.code}, is not approved.`,
      'There are 1 pending question(s) in the origin exploration.',
      'There are 1 postponed question(s) in the origin exploration.',
      'There are 1 pending proposal(s) affecting it.',
    ]),
  );
  expect((await readinessOf(person, projectId, bare.versionId)).reasons).toEqual(
    expect.arrayContaining(['It has no acceptance criteria.', 'It is not based on any decision.']),
  );

  // The assumed answer of its thread is a warning apart (◐), with the way to confirm it in the thread.
  await page.goto(`/p/${projectId}/records/${fdr.code}`);
  const panel = page.getByRole('region', { name: 'Before it can be built' });
  const assumed = panel.locator('[data-inferred-question]');
  await expect(assumed).toContainText('How many guests?');
  await expect(assumed.locator('[data-mark]').first()).toHaveAttribute('data-mark', 'assumed');
  await expect(assumed.getByRole('link', { name: /Confirm it in the thread/ })).toHaveAttribute(
    'href',
    `/p/${projectId}/threads/${thread.entity_id}`,
  );
  // Where it comes from: its thread.
  const context = page.getByRole('region', { name: 'Context' });
  await expect(context.getByRole('link', { name: 'Guest passes for open activities' })).toBeVisible();
  await expectAccessible(page, 'a record that is not ready');
});

test('AC-INT-001-08 without reasons it says Ready to build with the first bar full, and an approved version that stops being ready turns it rust', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Ready to build');
  const dec = await createDecision(person, projectId, 'Activities are public', { approve: true });
  const fdr = await createFeature(person, projectId, 'Activity catalog', {
    basedOn: { code: dec.code, version: 1 },
    approve: true,
  });
  expect((await readinessOf(person, projectId, fdr.versionId)).reasons).toEqual([]);

  await page.goto(`/p/${projectId}/records/${fdr.code}`);
  const aside = page.getByRole('complementary');
  await expect(aside.getByRole('heading', { name: 'Ready to build' })).toBeVisible();
  await expect(aside.locator('[data-readiness-reasons]')).toHaveCount(0);
  await expect(page.locator('[data-record-header] [data-stage]')).toHaveAttribute('data-stage', 'ready');
  await expect(aside.locator('[data-stage-track]')).toHaveAttribute('data-stage', 'ready');
  // What it touches: the decision it is based on, with its mark.
  const context = page.getByRole('region', { name: 'Context' });
  await expect(context.locator(`[data-link-target="${dec.code}"]`)).toContainText('Activities are public');
  await expect(context.locator(`[data-link-target="${dec.code}"] [data-mark]`).first()).toHaveAttribute('data-mark', 'confirmed');
  await expectAccessible(page, 'a record ready to build');

  // A new approved version of the decision leaves the feature in doubt: the first bar turns rust.
  const v2 = await person.command(projectId, 'record_version.create', {
    record_id: dec.recordId,
    title: 'Activities are public',
    sections: SECTIONS,
    change_note: 'Only open activities are public.',
  });
  await person.command(projectId, 'record_version.approve', {}, v2.entity_id);
  const readiness = await readinessOf(person, projectId, fdr.versionId);
  expect(readiness.ready).toBe(false);
  await expect(page.locator('[data-record-header] [data-stage]')).toHaveAttribute('data-stage', 'doubt');
  await expect(aside.getByRole('heading', { name: 'Before it can be built' })).toBeVisible();
  await expect(aside.locator('[data-readiness-reasons] li')).toHaveText(readiness.reasons);
  await expect(page.getByText('Ready to build', { exact: true })).toHaveCount(0);
});

test('AC-INT-001-04 a record an agent proposed stays Proposed after a person accepts it, until a person approves it', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Proposed by an agent');
  const agent = await person.agent(projectId, 'claude-code');
  const batch = await agent.command<{ batchId: string; proposals: string[] }>('batch.submit', {
    summary: 'Guests',
    proposals: [
      {
        type: 'decision',
        payload: {
          title: 'Two guests per member',
          context: 'Members ask to bring friends.',
          decision: 'Each member can bring two guests.',
          consequences: 'Places are counted with the guests.',
        },
      },
    ],
  });
  const accepted = await person.command<{ code: string }>(projectId, 'proposal.accept', {}, batch.result?.proposals[0]);
  const code = accepted.result?.code ?? '';

  await page.goto(`/p/${projectId}/records/${code}`);
  const header = page.locator('[data-record-header]');
  await expect(page.getByRole('heading', { level: 1, name: 'Two guests per member' })).toBeVisible();
  await expect(header.locator('[data-status] [data-mark]')).toHaveAttribute('data-mark', 'proposed');
  await expect(page.locator('[data-mark="confirmed"]')).toHaveCount(0);
  const versions = page.getByRole('region', { name: 'Versions' });
  await expect(versions.locator('[data-version="1"] [data-mark]').first()).toHaveAttribute('data-mark', 'proposed');

  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Approve' }).click();
  await expect(header.locator('[data-status] [data-mark]')).toHaveAttribute('data-mark', 'confirmed');
  await expect(versions.locator('[data-version="1"] [data-mark]').first()).toHaveAttribute('data-mark', 'confirmed');
  await expect(header.locator('[data-who]').last()).toHaveAttribute('data-who', 'you');
});
