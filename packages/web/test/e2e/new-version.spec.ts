// New version of a record (DESIGN.md §3.6, INV-NEWVER-*): a note and a choice per check before it can
// be saved, edits under Change that survive trying Keep, the verifiability warning that doesn't
// block and is shown again on the saved version's page, and a rejected save that keeps the text.

import { createDecision, createFeature, readinessOf, recordOf, shot } from './record-setup.ts';
import { BASE_URL, expect, expectAccessible, screenshot, test } from './support/fixtures.ts';

async function approvedFeature(person: Parameters<typeof createDecision>[0], name: string) {
  const projectId = await person.createProject(name);
  const dec = await createDecision(person, projectId, 'Activities are public', { approve: true });
  const fdr = await createFeature(person, projectId, 'Activity catalog', {
    basedOn: { code: dec.code, version: 1 },
    approve: true,
  });
  return { projectId, dec, fdr };
}

test('AC-INT-001-06 a new version cannot be saved without a note or a choice per check, and the saved version reflects each choice', async ({
  page,
  person,
}) => {
  const { projectId, fdr } = await approvedFeature(person, 'New version');
  await page.goto(`/p/${projectId}/records/${fdr.code}`);
  await page.locator('[data-record-actions]').getByRole('link', { name: 'New version' }).click();
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}/records/${fdr.code}/new-version`);
  await expect(page.getByRole('heading', { level: 1, name: /New version of Activity catalog/ })).toBeVisible();

  const save = page.getByRole('button', { name: 'Save draft' });
  const missing = page.locator('[data-missing]');
  await expect(save).toBeDisabled();
  await expect(missing).toContainText('Say what changed.');
  await expect(missing).toContainText('Choose Keep, Change or Drop for 3 checks.');
  await expectAccessible(page, 'the new version form');

  await page.getByLabel('What changed').fill('Past activities go to their own tab.');
  await expect(missing).not.toContainText('Say what changed.');
  await expect(save).toBeDisabled();

  const check = (code: string) => page.getByRole('group', { name: new RegExp(code) });
  await check('AC-CAT-001-01').getByRole('radio', { name: /^Keep/ }).check();
  await expect(missing).toContainText('Choose Keep, Change or Drop for 2 checks.');
  await check('AC-CAT-001-02')
    .getByRole('radio', { name: /^Change/ })
    .check();
  const edited = page.locator('[data-criterion="AC-CAT-001-02"]');
  const newStatement = 'When a member opens an activity, then it shows its date, its place and how many places are left.';
  await edited.getByLabel('Statement').fill(newStatement);
  // Trying Keep shows the check as it was, and keeps the edits for when Change comes back.
  await check('AC-CAT-001-02').getByRole('radio', { name: /^Keep/ }).check();
  await expect(edited).toContainText('Your edits are kept');
  await expect(edited).not.toContainText(newStatement);
  await check('AC-CAT-001-02')
    .getByRole('radio', { name: /^Change/ })
    .check();
  await expect(edited.getByLabel('Statement')).toHaveValue(newStatement);
  await check('AC-CAT-001-03').getByRole('radio', { name: /^Drop/ }).check();
  await expect(save).toBeEnabled();

  await page.getByRole('button', { name: 'Add a check' }).click();
  const added = page.locator('[data-criterion="new-1"]');
  await expect(save).toBeDisabled();
  await expect(missing).toContainText('Give the new check a title, a statement and how it is checked.');
  await added.getByLabel('Title').fill('Past activities');
  await added.getByLabel('Statement').fill('When a member opens Past, then they see finished activities, the most recent first.');
  await added.getByLabel('How it is checked').fill('An end-to-end test opens Past and checks the order.');
  await expect(save).toBeEnabled();
  await expect(missing).toHaveCount(0);

  await save.click();
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}/records/${fdr.code}?v=2`);
  await expect(page.locator('[data-record-header]')).toContainText('Draft');
  await expect(page.locator('[data-record-actions]').getByRole('button', { name: 'Approve' })).toBeInViewport();

  const r = await recordOf(person, projectId, fdr.code);
  const v2 = r.versions.find((v) => v.n === 2);
  expect(v2?.state).toBe('draft');
  expect(v2?.change_note).toBe('Past activities go to their own tab.');
  expect(v2?.criteria.map((c) => [c.code, c.carry])).toEqual([
    ['AC-CAT-001-01', 'kept'],
    ['AC-CAT-001-02', 'modified'],
    ['AC-CAT-001-04', 'new'],
  ]);
  expect(v2?.criteria[1]?.statement).toBe(newStatement);
  // Its links come along as they were: it is still based on the decision.
  const readiness = await readinessOf(person, projectId, v2?.id ?? '');
  expect(readiness.reasons).not.toContain('It is not based on any decision.');
});

test('AC-INT-001-07 a check with a vague term shows the verifiability warning when leaving the field and is saved anyway', async ({
  page,
  person,
}) => {
  const { projectId, fdr } = await approvedFeature(person, 'Vague check');
  await page.goto(`/p/${projectId}/records/${fdr.code}/new-version`);
  await page.getByLabel('What changed').fill('The catalog has to be quick.');
  for (const code of ['AC-CAT-001-01', 'AC-CAT-001-02', 'AC-CAT-001-03']) {
    await page
      .getByRole('group', { name: new RegExp(code) })
      .getByRole('radio', { name: /^Keep/ })
      .check();
  }
  await page.getByRole('button', { name: 'Add a check' }).click();
  const added = page.locator('[data-criterion="new-1"]');
  await added.getByLabel('Title').fill('Fast catalog');
  const statement = added.getByLabel('Statement');
  await statement.fill('The catalog is fast.');
  await expect(added.locator('[data-verifiability]')).toHaveCount(0);
  await added.getByLabel('How it is checked').focus();
  const warning = added.locator('[data-verifiability]');
  await expect(warning).toContainText('"fast" is vague; state a measure or a checkable result.');
  await added.getByLabel('How it is checked').fill('You open the catalog and time it.');
  const you = added.getByRole('radio', { name: /^You/ });
  await you.check();
  await expect(you).toBeChecked();

  const save = page.getByRole('button', { name: 'Save draft' });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}/records/${fdr.code}?v=2`);
  const r = await recordOf(person, projectId, fdr.code);
  const v2 = r.versions.find((v) => v.n === 2);
  expect(v2?.criteria.find((c) => c.code === 'AC-CAT-001-04')).toMatchObject({
    statement: 'The catalog is fast.',
    verification: 'manual',
  });
  // What the save said is shown once on the new version's page (the old form dropped it).
  const notices = page.locator('[data-record-notices]');
  await expect(notices).toContainText('Saved, with warnings');
  await expect(notices).toContainText('AC-CAT-001-04: "fast" is vague');
  await shot(page, 'record-saved-with-warnings');
  // The record keeps saying it, next to the check and apart in its readiness.
  const saved = page.locator('[data-check="AC-CAT-001-04"]');
  await expect(saved).toContainText('"fast" is vague');
  await expect(
    page.getByRole('complementary').locator('[data-kind="warning"]').filter({ hasText: '"fast" is vague' }),
  ).toContainText('AC-CAT-001-04: "fast" is vague');
});

test('AC-INT-001-06 a rejected save keeps what was written and shows the server reasons next to it', async ({ page, person }) => {
  const { projectId, fdr } = await approvedFeature(person, 'Rejected save');
  await page.goto(`/p/${projectId}/records/${fdr.code}/new-version`);
  await page.getByLabel('What changed').fill('A note that must survive.');
  for (const code of ['AC-CAT-001-01', 'AC-CAT-001-02', 'AC-CAT-001-03']) {
    await page
      .getByRole('group', { name: new RegExp(code) })
      .getByRole('radio', { name: /^Keep/ })
      .check();
  }
  // Meanwhile someone saves another version with one more check: this form no longer covers them all.
  const base = await recordOf(person, projectId, fdr.code);
  await person.command(projectId, 'record_version.create', {
    record_id: fdr.recordId,
    title: 'Activity catalog',
    sections: base.versions[0]?.sections,
    change_note: 'Another change.',
    links: [],
    criteria: [
      { carry: 'kept', code: 'AC-CAT-001-01' },
      { carry: 'kept', code: 'AC-CAT-001-02' },
      { carry: 'kept', code: 'AC-CAT-001-03' },
      {
        carry: 'new',
        title: 'Another check',
        statement: 'When a member opens Activities, then the list loads.',
        verification: 'automatic',
        check: 'A test opens it.',
      },
    ],
  });
  await page.getByRole('button', { name: 'Save draft' }).click();
  const reasons = page.locator('[data-reasons]');
  await expect(reasons).toBeVisible();
  await expect(reasons).toContainText('AC-CAT-001-04');
  await expect(reasons).not.toHaveText(/^Error$/);
  await expect(page.getByLabel('What changed')).toHaveValue('A note that must survive.');
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}/records/${fdr.code}/new-version`);
});

test('screens of cut 4: the new version form, with a check changed, one dropped and a vague new one', async ({
  page,
  person,
}) => {
  const { projectId, fdr } = await approvedFeature(person, 'Club Activities');
  await page.goto(`/p/${projectId}/records/${fdr.code}`);
  await page.locator('[data-record-actions]').getByRole('link', { name: 'New version' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /New version of Activity catalog/ })).toBeVisible();
  await screenshot(page, 4, '01-new-version-form');
  await shot(page, 'new-version');

  await page.getByLabel('What changed').fill('Past activities go to their own tab, so last year is easy to find.');
  const check = (code: string) => page.getByRole('group', { name: new RegExp(code) });
  await check('AC-CAT-001-01').getByRole('radio', { name: /^Keep/ }).check();
  await check('AC-CAT-001-02')
    .getByRole('radio', { name: /^Change/ })
    .check();
  await page
    .locator('[data-criterion="AC-CAT-001-02"]')
    .getByLabel('Statement')
    .fill('When a member opens an activity, then it shows its date, its place and how many places are left.');
  await check('AC-CAT-001-03').getByRole('radio', { name: /^Drop/ }).check();
  await page.getByRole('button', { name: 'Add a check' }).click();
  const added = page.locator('[data-criterion="new-1"]');
  await added.getByLabel('Title').fill('Past is easy to find');
  await added.getByLabel('Statement').fill('Past activities are easy to find.');
  await added.getByLabel('How it is checked').focus();
  await expect(added.locator('[data-verifiability]')).toBeVisible();
  await check('AC-CAT-001-02').scrollIntoViewIfNeeded();
  await screenshot(page, 4, '02-new-version-checks');
  await shot(page, 'new-version-checks');
  await shot(page, 'new-version-full', true);
});
