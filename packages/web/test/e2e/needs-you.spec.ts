// Needs you and Catch up (DESIGN.md §3.1): the queue on the left, the selected thing in full on the
// right with its decision at the bottom; Catch up walks the same things one at a time. The count is
// the sidebar's (the rebuilt shell has no header count).

import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import {
  agentBatch,
  assessed,
  conflict,
  decision,
  decisionProposal,
  designPackage,
  everyKind,
  inboxOf,
  knowledgeSettled,
  tabTo,
  threadWithQuestions,
} from './needs-data.ts';
import { expect, expectAccessible, type PersonApi, screenshot, test } from './support/fixtures.ts';

/** The accent count of Needs you in the sidebar. */
const sidebarCount = (page: Page) => page.locator('nav [data-nav="needs"] [data-count]');

/** What the sidebar count says (0 when it shows none). */
async function shown(page: Page): Promise<number> {
  const el = sidebarCount(page);
  return (await el.count()) > 0 ? Number(await el.getAttribute('data-count')) : 0;
}

/** Nothing is still arriving: no run of DEMIURGO works and the knowledge took everything in. */
async function quiet(person: PersonApi, projectId: string): Promise<void> {
  await person.until<{ state: string }[]>(`/api/projects/${projectId}/runs`, (runs) =>
    runs.every((r) => r.state !== 'queued' && r.state !== 'running'),
  );
  await knowledgeSettled(person, projectId);
}

/**
 * A thing decided in its detail leaves the queue, and the sidebar count follows the inbox without a
 * reload: it goes down, unless the decision itself brings something (answering a question of a
 * guided thread shows the next one of its stage) or the knowledge adds something meanwhile.
 */
async function resolvesInPlace(
  page: Page,
  person: PersonApi,
  projectId: string,
  detailOf: Locator,
  action: () => Promise<void>,
): Promise<void> {
  const key = (await detailOf.getAttribute('data-need')) ?? '';
  const before = await shown(page);
  await action();
  await expect(page.locator(`[role="option"][data-need="${key}"]`)).toHaveCount(0);
  await quiet(person, projectId);
  const total = (await inboxOf(person, projectId)).total;
  if (total > 0) await expect(sidebarCount(page)).toHaveAttribute('data-count', String(total));
  else await expect(sidebarCount(page)).toHaveCount(0);
  expect(total).toBeLessThanOrEqual(before);
}

/** The rank of a kind in Catch up, for the kinds this walk meets. */
const rank = (k: string) => ['conflict', 'question', 'proposal', 'version'].indexOf(k);

const group = (page: Page, name: string) => page.getByRole('group', { name: new RegExp(`^${name}`) });
const detail = (page: Page) => page.locator('[data-detail]');

/** Selects a row of the queue and waits for its detail. */
async function pick(page: Page, option: Locator): Promise<Locator> {
  const key = await option.first().getAttribute('data-need');
  await option.first().click();
  const d = page.locator(`[data-detail][data-need="${key}"]`);
  await expect(d).toBeVisible();
  return d;
}

/** Screenshots for the visual review of the rebuild, when E2E_SHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SHOTS;
  if (!dir) return;
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}

test('AC-INT-001-11 every kind of thing in the inbox appears in Needs you and is resolved in place, and the count goes down with each', async ({
  page,
  person,
}) => {
  test.setTimeout(150_000);
  const projectId = await person.createProject('Every kind');
  await everyKind(person, projectId);
  // What DEMIURGO and the knowledge still bring arrives before the page opens.
  await quiet(person, projectId);
  await page.goto(`/p/${projectId}/needs-you`);
  await expect(page.getByRole('heading', { level: 1, name: /Needs you/ })).toBeVisible();
  for (const name of [
    'Conflicts',
    'Questions',
    'Proposals',
    'Versions to approve',
    'Links to review',
    'Classifications to review',
    'Knowledge updates that failed',
  ]) {
    await expect(group(page, name)).toBeVisible();
  }
  // No package: the header's count is the rows, the same as the sidebar's.
  await expect(sidebarCount(page)).toHaveAttribute('data-count', /\d+/);
  await expect(page.locator('[data-count-summary]')).toHaveText(`${await shown(page)} things`);
  expect(await page.getByRole('option').count()).toBe(await shown(page));
  await expectAccessible(page, 'Needs you');

  // A conflict: DEMIURGO recommends, the person keeps the record as it is.
  let d = await pick(page, group(page, 'Conflicts').getByRole('option'));
  await expect(d).toContainText('DEMIURGO recommends');
  await resolvesInPlace(page, person, projectId, d, async () => {
    await d.getByRole('button', { name: 'Keep it as it is' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Keep it as it is' }).click();
  });

  // An assumed question, confirmed with DEMIURGO's reasoning in view; an open one, answered.
  const questions = group(page, 'Questions');
  d = await pick(page, questions.getByRole('option', { name: /Who are the users/ }));
  await expect(d.locator('[data-assumed]')).toContainText("DEMIURGO's assumed answer");
  await resolvesInPlace(page, person, projectId, d, async () => {
    await d.getByRole('button', { name: 'Confirm', exact: true }).click();
    // Confirming an assumed answer is decisive: it asks first.
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  });
  d = await pick(page, questions.getByRole('option', { name: /Can guests sign up/ }));
  await resolvesInPlace(page, person, projectId, d, async () => {
    // Answered right here, as in its thread: one click on an option, and Answer. No dialog.
    await expect(d.getByRole('link', { name: 'Continue in the thread' })).toHaveAttribute('href', /[?&]question=/);
    await expect(d.getByRole('button', { name: 'Answer', exact: true })).toBeDisabled();
    await d.getByRole('radio', { name: /Only members sign up/ }).check();
    await d.getByRole('button', { name: 'Answer', exact: true }).click();
  });

  // The agent's proposal, rejected with its author visible.
  d = await pick(page, group(page, 'Proposals').getByRole('option', { name: /Guests see the catalog/ }));
  await expect(d).toContainText('Agent · claude-code');
  await resolvesInPlace(page, person, projectId, d, async () => {
    await d.getByRole('button', { name: 'Reject', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Reason').fill('Not for now.');
    await page.getByRole('dialog').getByRole('button', { name: 'Reject' }).click();
  });

  // The draft, discarded (approving is walked in Catch up).
  d = await pick(page, group(page, 'Versions to approve').getByRole('option'));
  await expect(d).toContainText('Sign up for an activity');
  await expect(d.getByRole('button', { name: 'Approve' })).toBeVisible();
  await resolvesInPlace(page, person, projectId, d, async () => {
    await d.getByRole('button', { name: 'Discard' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
  });

  // The link, kept.
  d = await pick(page, group(page, 'Links to review').getByRole('option'));
  await expect(d).toContainText('is based on');
  await resolvesInPlace(page, person, projectId, d, async () => {
    await d.getByRole('button', { name: 'Keep', exact: true }).click();
  });

  // A classification, resolved among the categories of the approved taxonomy.
  d = await pick(page, group(page, 'Classifications to review').getByRole('option'));
  await expect(d).toContainText('No category fits.');
  await resolvesInPlace(page, person, projectId, d, async () => {
    await d.getByText('Reports', { exact: true }).click();
    await d.getByRole('button', { name: 'Resolve' }).click();
  });

  // The failed knowledge update, retried.
  d = await pick(page, group(page, 'Knowledge updates that failed').getByRole('option'));
  await resolvesInPlace(page, person, projectId, d, async () => {
    await d.getByRole('button', { name: 'Retry', exact: true }).click();
  });
  await expect(group(page, 'Knowledge updates that failed')).toHaveCount(0);

  // The retried update was applied in the background: nothing failed is left.
  const after = await inboxOf(person, projectId);
  expect(after.rejected_updates).toHaveLength(0);
});

test('AC-INT-001-11 a decided thing leaves, the next one is selected and takes the focus, and the header reconciles a package', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Moves on');
  const d = await decision(person, projectId, 'Members sign up for activities', 'Members sign up in one step.');
  await designPackage(person, projectId, d);
  const { batchId } = await agentBatch(person, projectId, [
    decisionProposal('Guests see the catalog', 'Guests can see the catalog but not sign up.'),
    decisionProposal('Full activities say Full', 'Full activities say “Full”.'),
  ]);
  await assessed(person, projectId, batchId);
  const inbox = await inboxOf(person, projectId);
  const pkg = inbox.batches.find((b) => b.type === 'system_package');
  const inside = pkg?.proposals.length ?? 0;
  await page.goto(`/p/${projectId}/needs-you`);
  // The server counts each proposal of the package; the queue shows the package once, and says so.
  const rows = await page.getByRole('option').count();
  await expect(page.locator('[data-count-summary]')).toHaveText(
    inside > 1
      ? `${inbox.total} things: 1 package of ${inside} proposals and ${rows - 1} other ${rows - 1 === 1 ? 'thing' : 'things'}`
      : `${inbox.total} things`,
  );

  const first = group(page, 'Proposals').getByRole('option', { name: /Guests see the catalog/ });
  const detailOf = await pick(page, first);
  await detailOf.getByRole('button', { name: 'Accept as draft', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('as a draft. You approve it later, on its page.');
  await confirm.getByRole('button', { name: 'Accept as draft' }).click();
  // Never optimistic: the item leaves only once the server said yes; then the next one is selected.
  await expect(first).toHaveCount(0);
  const selected = page.getByRole('option', { selected: true });
  await expect(selected).toHaveCount(1);
  const key = await selected.getAttribute('data-need');
  await expect(detail(page)).toHaveAttribute('data-need', key ?? '');
  await expect(page.locator('#need-detail-title')).toBeFocused();
  await expect(page.locator('[data-announcer]')).toContainText('left in Needs you');
});

test('AC-INT-001-14 a 409, a 422 and a 403 show their reasons next to the action, keep what was written and never a bare Error', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Errors');
  const { batchId, proposals } = await agentBatch(person, projectId, [
    decisionProposal('Guests see the catalog', 'Guests can see the catalog but not sign up.'),
    decisionProposal('Full activities say Full', 'Full activities say “Full”.'),
  ]);
  await assessed(person, projectId, batchId);
  // What another tab does is not streamed to this one: the page keeps showing the proposal.
  await page.route('**/events/stream**', (route) => route.abort());
  await page.goto(`/p/${projectId}/needs-you`);
  const options = group(page, 'Proposals').getByRole('option');
  await expect(options).toHaveCount(2);

  // 409: the person already accepted it in another tab.
  await person.command(projectId, 'proposal.accept', {}, proposals[0]);
  let d = await pick(page, options.filter({ hasText: 'Guests see the catalog' }));
  await d.getByRole('button', { name: 'Accept as draft', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await confirm.getByRole('button', { name: 'Accept as draft' }).click();
  const conflictReasons = confirm.getByRole('alert');
  await expect(conflictReasons).toContainText("It can't be done right now.");
  await expect(conflictReasons).toContainText('Accepted');
  await expect(page.getByText('Error', { exact: true })).toHaveCount(0);
  await confirm.getByRole('button', { name: 'Not now' }).click();
  // Closing after a 409 fetches the page again: the accepted proposal is gone.
  await expect(options.filter({ hasText: 'Guests see the catalog' })).toHaveCount(0);

  // 422: a reason longer than the server takes.
  d = await pick(page, options.filter({ hasText: 'Full activities say Full' }));
  await d.getByRole('button', { name: 'Reject', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const long = 'Too long. '.repeat(210);
  await dialog.getByLabel('Reason').fill(long);
  await dialog.getByRole('button', { name: 'Reject' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Some of what you wrote needs a change.');
  await expect(dialog.getByRole('alert')).toContainText('reason');
  await expect(dialog.getByLabel('Reason')).toHaveValue(long);

  // 403: the same command without the CSRF header of the session.
  await page.route('**/commands/proposal.reject', async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['x-demiurgo-csrf'];
    await route.continue({ headers });
  });
  await dialog.getByLabel('Reason').fill('We keep the number.');
  await dialog.getByRole('button', { name: 'Reject' }).click();
  await expect(dialog.getByRole('alert')).toContainText("This isn't allowed here.");
  await expect(dialog.getByRole('alert')).toContainText('CSRF');
  await expect(dialog.getByLabel('Reason')).toHaveValue('We keep the number.');
  await expect(page.getByText('Error', { exact: true })).toHaveCount(0);
  await expectAccessible(page, 'an error next to its action');
});

test('AC-WEB-001-03 Needs you and Catch up work with the keyboard only', async ({ page, person }) => {
  const projectId = await person.createProject('Keyboard catch up');
  await decision(person, projectId, 'Organizers set a limit on places', 'Organizers set a limit on places.', false);
  const { batchId } = await agentBatch(person, projectId, [
    decisionProposal('Guests see the catalog', 'Guests can see the catalog but not sign up.'),
    decisionProposal('Full activities say Full', 'Full activities say “Full”.'),
  ]);
  await assessed(person, projectId, batchId);
  await page.goto(`/p/${projectId}/needs-you`);

  // The queue is a listbox: Tab reaches the selected row, the arrows move, Enter goes into the detail.
  const options = page.getByRole('option');
  await tabTo(page, options.first(), 60);
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toBeFocused();
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(detail(page)).toHaveAttribute('data-need', (await options.nth(1).getAttribute('data-need')) ?? '');
  await page.keyboard.press('Enter');
  await expect(page.locator('#need-detail-title')).toBeFocused();

  // Back up to Catch up, still with the keyboard.
  await tabTo(page, page.getByRole('link', { name: 'Catch up' }), 60, true);
  await page.keyboard.press('Enter');
  const band = page.getByRole('region', { name: 'Catching up' });
  const progress = band.locator('[data-progress]');
  await expect(progress).toContainText('1 of 3');
  // Catch up puts the focus on the thing to decide; Skip and Leave sit right above it.
  await expect(page.locator('#need-detail-title')).toBeFocused();
  await tabTo(page, band.getByRole('button', { name: 'Skip' }), 10, true);
  await page.keyboard.press('Enter');
  await expect(progress).toContainText('2 of 3');
  const focus = detail(page);
  await expect(focus).toContainText('Full activities say Full');
  await expect(page.locator('#need-detail-title')).toBeFocused();
  await tabTo(page, focus.getByRole('button', { name: 'Reject', exact: true }));
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Reason')).toBeFocused();
  await page.keyboard.type('We keep the number.');
  await tabTo(page, dialog.getByRole('button', { name: 'Reject' }), 5);
  await page.keyboard.press('Enter');
  await expect(progress).toContainText('3 of 3');
  await expect(focus).toHaveAttribute('data-kind', 'version');
  await expect(page.locator('#need-detail-title')).toBeFocused();

  await tabTo(page, band.getByRole('button', { name: 'Leave' }), 20, true);
  await page.keyboard.press('Enter');
  await expect(page).not.toHaveURL(/catch-up/);
  await expect(group(page, 'Proposals')).toContainText('Guests see the catalog');
});

test('AC-INT-001-16 Catch up walks Needs you one at a time in the defined order, can be left at any time, and what is skipped stays in Needs you', async ({
  page,
  person,
}) => {
  test.setTimeout(150_000);
  const projectId = await person.createProject('Catch up');
  // 1: a conflict with something approved.
  await conflict(person, projectId, 'the calendar');
  // 2: an open question that blocks a feature: the feature was drafted from its thread.
  const thread = await threadWithQuestions(person, projectId, 'How members sign up');
  type Inbox = { batches: { type: string; producer: string; proposals: { id: string; type: string }[] }[] };
  const chat = await person.get<Inbox>(`/api/projects/${projectId}/inbox`);
  const heard = chat.batches.find((b) => b.producer.startsWith('agent:run:'))?.proposals[0]?.id ?? '';
  const accepted = await person.command<{ code: string; versionId: string; recordId: string }>(
    projectId,
    'proposal.accept',
    { approve: true },
    heard,
  );
  const packageId = await designPackage(person, projectId, {
    code: accepted.result?.code ?? '',
    versionId: accepted.result?.versionId ?? '',
    recordId: accepted.result?.recordId ?? '',
    version: 1,
  });
  await person.command(projectId, 'batch.accept_package', {}, packageId);
  // 3: an agent's proposal.
  const { batchId } = await agentBatch(person, projectId, [
    decisionProposal('Guests see the catalog', 'Guests can see the catalog but not sign up.'),
  ]);
  await assessed(person, projectId, batchId);
  await knowledgeSettled(person, projectId);

  await page.goto(`/p/${projectId}/needs-you`);
  await page.getByRole('link', { name: 'Catch up' }).click();
  await expect(page).toHaveURL(/catch-up=1/);
  const band = page.getByRole('region', { name: 'Catching up' });
  const progress = band.locator('[data-progress]');
  const focus = detail(page);
  const walk = page.getByRole('region', { name: 'In order' });

  // The walk goes in the defined order: the conflict with something approved, the questions that
  // block the design, the proposals, then the version to approve.
  const steps = walk.locator('li[data-step]');
  const total = await steps.count();
  const kinds: string[] = [];
  for (let i = 0; i < total; i++) kinds.push((await steps.nth(i).getAttribute('data-step-kind')) ?? '');
  expect(kinds[0]).toBe('conflict');
  expect(kinds.at(-1)).toBe('version');
  expect(kinds.map(rank)).toEqual(kinds.map(rank).toSorted((a, b) => a - b));
  expect(kinds.filter((k) => k === 'question').length).toBeGreaterThanOrEqual(2);

  await expect(progress).toContainText(`1 of ${total}`);
  await expect(focus).toHaveAttribute('data-kind', 'conflict');
  await expect(focus).toContainText('DEMIURGO recommends');
  await expect(focus.getByText('To review', { exact: true })).toBeVisible();
  await expect(focus.getByText('The change', { exact: true })).toBeVisible();
  // Each step of the walk says where it is in words.
  await expect(walk.locator('li[aria-current="step"]')).toContainText('Now');
  await expectAccessible(page, 'Catch up');
  await band.getByRole('button', { name: 'Skip' }).click();
  await expect(steps.first()).toContainText('Skipped');

  // The questions of its thread block the design: each says so, and is skipped.
  let at = 2;
  while (kinds[at - 1] === 'question') {
    await expect(progress).toContainText(`${at} of ${total}`);
    await expect(focus).toHaveAttribute('data-kind', 'question');
    await expect(page.getByRole('region', { name: 'What it unblocks' })).toContainText('Design:');
    await band.getByRole('button', { name: 'Skip' }).click();
    at += 1;
  }

  // The proposals, rejected; the version, approved.
  while (kinds[at - 1] === 'proposal') {
    await expect(progress).toContainText(`${at} of ${total}`);
    await expect(focus).toHaveAttribute('data-kind', 'proposal');
    await focus.getByRole('button', { name: 'Reject', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Reject' }).click();
    at += 1;
  }
  await expect(progress).toContainText(`${total} of ${total}`);
  await expect(focus).toHaveAttribute('data-kind', 'version');
  await focus.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Approve' }).click();
  await expect(walk.locator('li[data-step-state="done"]')).toHaveCount(
    kinds.filter((k) => k !== 'conflict' && k !== 'question').length,
  );

  // Leave at any time: what was skipped (and not reached) is still in Needs you.
  await band.getByRole('button', { name: 'Leave' }).click();
  await expect(page).not.toHaveURL(/catch-up/);
  await expect(group(page, 'Conflicts')).toBeVisible();
  const questions = group(page, 'Questions');
  await expect(questions).toContainText('Can guests sign up without an account?');
  await expect(questions.getByRole('option')).toHaveCount(kinds.filter((k) => k === 'question').length);
  await expect(group(page, 'Proposals')).toHaveCount(0);
  await expect(group(page, 'Versions to approve')).toHaveCount(0);
  expect(thread.open).toBeTruthy();
});

test('AC-INT-001-16 opening a package from Catch up and coming back keeps the place and the skips', async ({ page, person }) => {
  const projectId = await person.createProject('Catch up and back');
  const d = await decision(person, projectId, 'Members sign up for activities', 'Members sign up in one step.');
  const packageId = await designPackage(person, projectId, d);
  const { batchId } = await agentBatch(person, projectId, [
    decisionProposal('Guests see the catalog', 'Guests can see the catalog but not sign up.'),
  ]);
  await assessed(person, projectId, batchId);
  await page.goto(`/p/${projectId}/needs-you?catch-up=1`);
  const band = page.getByRole('region', { name: 'Catching up' });
  const progress = band.locator('[data-progress]');
  await expect(progress).toContainText('1 of 2');
  const kind = await detail(page).getAttribute('data-kind');
  if (kind !== 'package') {
    await band.getByRole('button', { name: 'Skip' }).click();
    await expect(progress).toContainText('2 of 2');
  }
  await expect(detail(page)).toHaveAttribute('data-kind', 'package');
  const position = (await progress.textContent()) ?? '';
  await detail(page)
    .getByRole('link', { name: /Open the package/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/batches/${packageId}$`));
  // The batch page knows it came from Catch up, and leads back to it.
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(crumbs).toContainText('Catching up');
  await crumbs.getByRole('link', { name: 'Catching up' }).click();
  await expect(page).toHaveURL(/catch-up=1/);
  await expect(progress).toHaveText(position);
  await expect(detail(page)).toHaveAttribute('data-kind', 'package');
});

test('screens of cut 5: Needs you with every group, Catch up, and Needs you empty', async ({ page, person }) => {
  test.setTimeout(150_000);
  const projectId = await person.createProject('Club Activities');
  await everyKind(person, projectId);
  await page.goto(`/p/${projectId}/needs-you`);
  await expect(group(page, 'Knowledge updates that failed')).toBeVisible();
  await screenshot(page, 5, '01-needs-you');
  await shot(page, '01-needs-you-conflict');
  await pick(page, group(page, 'Questions').getByRole('option', { name: /Who are the users/ }));
  await screenshot(page, 5, '02-needs-you-question');
  await shot(page, '02-needs-you-question');
  await pick(page, group(page, 'Proposals').getByRole('option', { name: /Guests see the catalog/ }));
  await screenshot(page, 5, '03-needs-you-proposal');
  await shot(page, '03-needs-you-proposal');
  await pick(page, group(page, 'Versions to approve').getByRole('option'));
  await shot(page, '04-needs-you-version');
  await pick(page, group(page, 'Links to review').getByRole('option'));
  await shot(page, '05-needs-you-link');
  await pick(page, group(page, 'Classifications to review').getByRole('option'));
  await shot(page, '06-needs-you-classification');
  await pick(page, group(page, 'Knowledge updates that failed').getByRole('option'));
  await screenshot(page, 5, '04-needs-you-bottom');
  await shot(page, '07-needs-you-update');

  // Under 1280 px the queue and the detail stack: a row opens its detail, with Back.
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, '08-needs-you-390-queue');
  await page.getByRole('option').nth(1).click();
  await expect(page.getByRole('button', { name: 'Back to Needs you' })).toBeVisible();
  await expectAccessible(page, 'Needs you at 390 px');
  await shot(page, '09-needs-you-390-detail');
  await page.getByRole('button', { name: 'Back to Needs you' }).click();
  await expect(page.getByRole('option').nth(1)).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(`/p/${projectId}/needs-you?catch-up=1`);
  const band = page.getByRole('region', { name: 'Catching up' });
  await expect(band.locator('[data-progress]')).toContainText('1 of');
  await expect(detail(page)).toHaveAttribute('data-kind', 'conflict');
  await expect(page.getByRole('img', { name: 'may contradict' })).toBeVisible();
  await screenshot(page, 5, '05-catch-up-conflict');
  await shot(page, '10-catch-up-conflict');
  await band.getByRole('button', { name: 'Skip' }).click();
  await expect(band.locator('[data-progress]')).toContainText('2 of');
  await screenshot(page, 5, '06-catch-up-next');
  await band.getByRole('button', { name: 'Skip' }).click();
  await band.getByRole('button', { name: 'Skip' }).click();
  await expect(band.locator('[data-progress]')).toContainText('4 of');
  await screenshot(page, 5, '07-catch-up-later');
  await shot(page, '11-catch-up-later');

  const empty = await person.createProject('Quiet');
  await decision(person, empty, 'Organizers publish activities', 'Organizers publish activities.');
  await page.goto(`/p/${empty}/needs-you`);
  await expect(page.getByText('Nothing needs you. You can close DEMIURGO.')).toBeVisible();
  await expectAccessible(page, 'Needs you empty');
  await screenshot(page, 5, '08-needs-you-empty');
  await shot(page, '12-up-to-date');
});
