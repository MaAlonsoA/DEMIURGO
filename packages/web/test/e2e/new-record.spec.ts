// A record written by hand (DESIGN.md §3.6): a tech decision created from the overview, with its
// template sections and a check, approved on its page and drawn in the Map; the form by keyboard;
// links born with their version; and the form never losing what was written.

import { createDecision, expectNoSideScroll, shot } from './record-setup.ts';
import { expect, expectAccessible, test } from './support/fixtures.ts';

test('a tech decision written by hand from the overview is saved as a draft, approved, and shows in the Map', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Hand made');
  await page.goto(`/p/${projectId}`);
  await page.getByRole('main').getByRole('link', { name: 'New record' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'New record' })).toBeVisible();

  await page.getByRole('radio', { name: 'Tech decision' }).check();
  await expect(page.getByRole('radio', { name: 'Tech decision' })).toBeChecked();
  const missing = page.locator('[data-missing]');
  await expect(missing).toContainText('Add at least one check: a tech decision needs them.');
  const save = page.getByRole('button', { name: 'Save draft' });
  await expect(save).toBeDisabled();

  const content = page.getByRole('region', { name: 'Content' });
  await content.getByLabel('Title', { exact: true }).fill('One database for everything');
  await content.getByLabel('Area').fill('Platform Core');
  await expect(missing).toContainText('like platform_core');
  await content.getByLabel('Area').fill('platform');
  for (const [section, text] of [
    ['Context', 'We need durable steps and a journal.'],
    ['Options', 'Postgres alone, or Postgres plus a queue.'],
    ['Decision', 'Postgres alone, with DBOS inside it.'],
    ['Consequences', 'One backup and one place to look.'],
  ] as const) {
    await content.getByLabel(section, { exact: true }).fill(text);
  }
  await page.getByRole('button', { name: 'Add a check' }).click();
  const check = page.locator('[data-criterion="new-1"]');
  await check.getByLabel('Title').fill('Only one database runs');
  await check.getByLabel('Statement').fill('Given the stack is up, when we list the databases, then only Postgres runs.');
  await check.getByLabel('How it is checked').fill('An integration test lists the running services.');
  await expect(missing).toHaveCount(0);
  await expectAccessible(page, 'a new record written by hand');
  await shot(page, 'new-record-filled');

  await save.click();
  await expect(page).toHaveURL((u) => u.pathname.endsWith('/records/ADR-PLA-001') && u.search === '?v=1');
  await expect(page.getByRole('heading', { level: 1, name: 'One database for everything' })).toBeVisible();
  const header = page.locator('[data-record-header]');
  await expect(header).toContainText('Draft');
  await header.getByRole('button', { name: 'Approve' }).click();
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
  await expect(page.getByRole('radio', { name: 'Decision', exact: true })).toBeChecked();
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

test('the new record keeps the text of a section another type drops, and leaving with unsaved text asks first', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Kept text');
  await page.goto(`/p/${projectId}/records/new?type=decision`);
  const content = page.getByRole('region', { name: 'Content' });
  await content.getByLabel('Title', { exact: true }).fill('Members only');
  await content.getByLabel('Context', { exact: true }).fill('Why it came up.');
  await content.getByLabel('Consequences', { exact: true }).fill('Visitors only look.');

  // A feature has no Consequences: its text is kept apart, not lost (INVENTORY INV-NEWREC, UX problem).
  await page.getByRole('radio', { name: 'Feature' }).check();
  const kept = page.getByRole('region', { name: 'What it is' });
  await expect(kept).toContainText('Kept from the previous type');
  await expect(kept).toContainText('Visitors only look.');
  await expect(content.getByLabel('Consequences', { exact: true })).toHaveCount(0);
  await shot(page, 'new-record-kept');
  // The form reflows at a phone's width, its footer too.
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoSideScroll(page, 'the new record form at 390 px');
  await shot(page, 'new-record-390');
  await page.setViewportSize({ width: 1440, height: 900 });
  // Back to a decision: it is in its section again.
  await page.getByRole('radio', { name: 'Decision', exact: true }).check();
  await expect(content.getByLabel('Consequences', { exact: true })).toHaveValue('Visitors only look.');
  await expect(kept).not.toContainText('Kept from the previous type');

  // Cancel asks first, and "Keep writing" keeps everything.
  await page.getByRole('button', { name: 'Cancel' }).click();
  const leave = page.getByRole('alertdialog', { name: 'Leave without saving?' });
  await expect(leave).toBeVisible();
  await expectAccessible(page, 'leaving the new record with unsaved text');
  await leave.getByRole('button', { name: 'Keep writing' }).click();
  await expect(leave).toBeHidden();
  await expect(content.getByLabel('Title', { exact: true })).toHaveValue('Members only');
  // Leaving through the sidebar asks too; leaving loses it.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Threads' }).click();
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: 'Leave and lose it' }).click();
  await expect(page).toHaveURL((u) => u.pathname.endsWith('/threads'));
});

test('links written by hand are born with their version: a new feature based on a decision, and a new version that adds a conflict and drops a carried link', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Hand links');
  const decision = await createDecision(person, projectId, 'Members only', { approve: true, domain: 'club' });
  const other = await createDecision(person, projectId, 'Visitors sign up too', { approve: true, domain: 'club' });

  // A new feature, based on the decision.
  await page.goto(`/p/${projectId}/records/new?type=fdr`);
  const content = page.getByRole('region', { name: 'Content' });
  await content.getByLabel('Title', { exact: true }).fill('Sign up for an activity');
  await content.getByLabel('Area').fill('club');
  for (const section of ['Goal', 'Scope', 'Out of scope', 'Behavior']) {
    await content.getByLabel(section, { exact: true }).fill(`${section} of signing up.`);
  }
  await page.getByRole('button', { name: 'Add a check' }).click();
  const check = page.locator('[data-criterion="new-1"]');
  await check.getByLabel('Title').fill('Members sign up');
  await check.getByLabel('Statement').fill('Given a member, when they sign up, then they are on the list.');
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
  await expect(page.locator(`[data-new-link="${decision.code}"]`)).toContainText('Carried');
  await page.getByLabel('Link type').selectOption({ label: 'Conflicts with' });
  await page.getByLabel('Links to').selectOption({ label: `${other.code} v1 · Visitors sign up too` });
  await page.getByRole('button', { name: 'Add link' }).click();
  await page.getByRole('radio', { name: /^Keep/ }).first().check();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL((u) => u.pathname.endsWith('/records/FDR-CLU-003') && u.search === '?v=2');
  await expect(page.locator(`[data-link-target="${decision.code}"]`)).toBeVisible();
  await expect(page.locator(`[data-link-target="${other.code}"]`)).toBeVisible();

  // A carried link can be removed from the next version (INVENTORY INV-NEWVER, UX problem).
  await page.goto(`/p/${projectId}/records/FDR-CLU-003/new-version`);
  await page.getByLabel('What changed').fill('It no longer conflicts.');
  await page.getByRole('button', { name: `Remove the link to ${other.code}` }).click();
  await expect(page.locator(`[data-new-link="${other.code}"]`)).toHaveCount(0);
  await page.getByRole('radio', { name: /^Keep/ }).first().check();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL((u) => u.pathname.endsWith('/records/FDR-CLU-003') && u.search === '?v=3');
  await expect(page.locator(`[data-link-target="${decision.code}"]`)).toBeVisible();
  await expect(page.locator(`[data-link-target="${other.code}"]`)).toHaveCount(0);
});
