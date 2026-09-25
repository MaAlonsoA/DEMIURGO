// A record written by hand: a tech decision (ADR) created from the overview, with its template
// sections and a check, approved in its page and drawn in the Map as a rule.

import { createDecision } from './record-setup.ts';
import { expect, expectAccessible, test } from './support/fixtures.ts';

test('a tech decision written by hand from the overview is saved as a draft, approved, and shows in the Map', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Hand made');
  await page.goto(`/p/${projectId}`);
  await page.getByRole('link', { name: 'New record' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'New record' })).toBeVisible();

  await page.getByRole('button', { name: 'Tech decision', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tech decision', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const missing = page.locator('[data-missing]');
  await expect(missing).toContainText('Add at least one check: a tech decision needs them.');
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();

  await page.getByLabel('Title', { exact: true }).first().fill('One database for everything');
  await page.getByLabel('Area').fill('Platform Core');
  await expect(missing).toContainText('like platform_core');
  await page.getByLabel('Area').fill('platform');
  for (const [section, text] of [
    ['Context', 'We need durable steps and a journal.'],
    ['Options', 'Postgres alone, or Postgres plus a queue.'],
    ['Decision', 'Postgres alone, with DBOS inside it.'],
    ['Consequences', 'One backup and one place to look.'],
  ] as const) {
    await page.getByLabel(section, { exact: true }).fill(text);
  }
  await page.getByRole('button', { name: 'Add a check' }).click();
  const check = page.locator('ol > li').last();
  await check.getByLabel('Title').fill('Only one database runs');
  await check.getByLabel(/Statement/).fill('Given the stack is up, when we list the databases, then only Postgres runs.');
  await check.getByLabel('How it is checked').fill('An integration test lists the running services.');
  await expect(missing).toHaveCount(0);
  await expectAccessible(page, 'a new record written by hand');

  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL((u) => u.pathname.endsWith('/records/ADR-PLA-001') && u.search === '?v=1');
  await expect(page.getByRole('heading', { level: 1, name: 'One database for everything' })).toBeVisible();
  const header = page.locator('[data-record-header]');
  await expect(header).toContainText('Draft');
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Approve' }).click();
  await expect(header).toContainText('Approved');

  const events = await person.get<{ command: string; actor: string }[]>(`/api/projects/${projectId}/events?from=0`);
  expect(events.filter((e) => e.command === 'record.create').map((e) => e.actor)).toEqual(['human:ana']);

  await page.goto(`/p/${projectId}/map`);
  await expect(page.locator('[data-map-node="ADR-PLA-001"]')).toBeVisible();
});

test('the new record form works with the keyboard only', async ({ page, person }) => {
  const projectId = await person.createProject('Keyboard record');
  await page.goto(`/p/${projectId}/records/new?type=decision`);
  await expect(page.getByRole('button', { name: 'Decision', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Title', { exact: true }).focus();
  await page.keyboard.type('Members only');
  await page.keyboard.press('Tab');
  await page.keyboard.type('club');
  for (const text of ['Why it came up.', 'Only members sign up.', 'Visitors only look.']) {
    await page.keyboard.press('Tab');
    await page.keyboard.type(text);
  }
  await expect(page.locator('[data-missing]')).toHaveCount(0);
  const save = page.getByRole('button', { name: 'Save draft' });
  await save.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL((u) => u.pathname.endsWith('/records/DEC-CLU-001') && u.search === '?v=1');
});

test('links written by hand are born with their version: a new feature based on a decision, and a new version that adds a conflict', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Hand links');
  const decision = await createDecision(person, projectId, 'Members only', { approve: true, domain: 'club' });
  const other = await createDecision(person, projectId, 'Visitors sign up too', { approve: true, domain: 'club' });

  // A new feature, based on the decision.
  await page.goto(`/p/${projectId}/records/new?type=fdr`);
  await page.getByLabel('Title', { exact: true }).first().fill('Sign up for an activity');
  await page.getByLabel('Area').fill('club');
  for (const section of ['Goal', 'Scope', 'Out of scope', 'Behavior']) {
    await page.getByLabel(section, { exact: true }).fill(`${section} of signing up.`);
  }
  await page.getByRole('button', { name: 'Add a check' }).click();
  const check = page.locator('ol > li').last();
  await check.getByLabel('Title').fill('Members sign up');
  await check.getByLabel(/Statement/).fill('Given a member, when they sign up, then they are on the list.');
  await check.getByLabel('How it is checked').fill('An end-to-end test signs up a member.');
  await page.getByLabel('Link type').selectOption({ label: 'Based on' });
  await page.getByLabel('Links to').selectOption({ label: `${decision.code} v1 · Members only` });
  await page.getByRole('button', { name: 'Add link' }).click();
  await expect(page.locator(`[data-new-link="${decision.code}"]`)).toContainText('Based on');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL((u) => u.pathname.endsWith('/records/FDR-CLU-003') && u.search === '?v=1');
  await expect(page.locator(`[data-link-target="${decision.code}"]`)).toBeVisible();

  // The decision shows who follows it.
  await page.goto(`/p/${projectId}/records/${decision.code}`);
  await expect(page.locator('[data-incoming]')).toContainText('Followed by');
  await expect(page.locator('[data-incoming]')).toContainText('FDR-CLU-003');

  // A new version of the feature keeps its link and adds a conflict with the other decision.
  await page.goto(`/p/${projectId}/records/FDR-CLU-003/new-version`);
  await page.getByLabel('What changed').fill('It conflicts with letting visitors sign up.');
  await page.getByLabel('Link type').selectOption({ label: 'Conflicts with' });
  await page.getByLabel('Links to').selectOption({ label: `${other.code} v1 · Visitors sign up too` });
  await page.getByRole('button', { name: 'Add link' }).click();
  await page.getByRole('radio', { name: 'Keep' }).first().check();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL((u) => u.pathname.endsWith('/records/FDR-CLU-003') && u.search === '?v=2');
  await expect(page.locator(`[data-link-target="${decision.code}"]`)).toBeVisible();
  await expect(page.locator(`[data-link-target="${other.code}"]`)).toBeVisible();
});
