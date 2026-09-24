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
import { expect, expectAccessible, screenshot, test } from './support/fixtures.ts';

/** The blue count of the header. */
const headerCount = (page: Page) => page.getByRole('navigation', { name: 'Main' }).locator('[data-needs]');

async function countGoesDown(page: Page, from: number, action: () => Promise<void>): Promise<number> {
  await expect(headerCount(page)).toHaveAttribute('data-needs', String(from));
  await action();
  await expect(headerCount(page)).toHaveAttribute('data-needs', String(from - 1));
  return from - 1;
}

const group = (page: Page, name: string) => page.getByRole('region', { name: new RegExp(`^${name}`) });
const first = (l: Locator) => l.locator('[data-need]').first();

test('AC-INT-001-11 every kind of thing in the inbox appears in Needs you and is resolved in place, and the count goes down with each', async ({
  page,
  person,
}) => {
  test.setTimeout(150_000);
  const projectId = await person.createProject('Every kind');
  const inbox = await everyKind(person, projectId);
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
  await expectAccessible(page, 'Needs you');
  let count = inbox.total;

  // A conflict: DEMIURGO recommends, the person keeps the record as it is.
  const conflictRow = first(group(page, 'Conflicts'));
  await expect(conflictRow).toContainText('DEMIURGO recommends');
  count = await countGoesDown(page, count, async () => {
    await conflictRow.getByRole('button', { name: 'Keep it as it is' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Keep it as it is' }).click();
  });

  // An assumed question, confirmed; an open one, answered.
  const questions = group(page, 'Questions');
  count = await countGoesDown(page, count, async () => {
    await questions
      .locator('[data-need]')
      .filter({ hasText: 'Who will use the product first' })
      .getByRole('button', { name: 'Confirm' })
      .click();
    // Confirming an assumed answer is decisive: it asks first.
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  });
  count = await countGoesDown(page, count, async () => {
    await questions
      .locator('[data-need]')
      .filter({ hasText: 'Can guests sign up' })
      .getByRole('button', { name: 'Answer' })
      .click();
    await page.getByRole('dialog').getByLabel('Conclusion').fill('Only members sign up; guests only look.');
    await page.getByRole('dialog').getByRole('button', { name: 'Answer' }).click();
  });

  // The agent's proposal, rejected with its author visible.
  const agentRow = group(page, 'Proposals').locator('[data-need]').filter({ hasText: 'Guests see the catalog' });
  await expect(agentRow.getByRole('img', { name: 'Agent · claude-code' })).toBeVisible();
  count = await countGoesDown(page, count, async () => {
    await agentRow.getByRole('button', { name: 'Reject' }).click();
    await page.getByRole('dialog').getByLabel('Reason').fill('Not for now.');
    await page.getByRole('dialog').getByRole('button', { name: 'Reject' }).click();
  });

  // The draft, discarded (approving is walked in Catch up).
  const version = first(group(page, 'Versions to approve'));
  await expect(version).toContainText('Sign up for an activity');
  await expect(version.getByRole('button', { name: 'Approve' })).toBeVisible();
  count = await countGoesDown(page, count, async () => {
    await version.getByRole('button', { name: 'Discard' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
  });

  // The link, kept.
  const link = first(group(page, 'Links to review'));
  await expect(link).toContainText('is based on');
  count = await countGoesDown(page, count, async () => {
    await link.getByRole('button', { name: 'Keep' }).click();
  });

  // A classification, resolved among the categories of the approved taxonomy.
  const classification = first(group(page, 'Classifications to review'));
  await expect(classification).toContainText('No category fits.');
  count = await countGoesDown(page, count, async () => {
    await classification.getByText('Reports', { exact: true }).click();
    await classification.getByRole('button', { name: 'Resolve' }).click();
  });

  // The failed knowledge update, retried.
  const update = first(group(page, 'Knowledge updates that failed'));
  count = await countGoesDown(page, count, async () => {
    await update.getByRole('button', { name: 'Retry', exact: true }).click();
  });
  await expect(group(page, 'Knowledge updates that failed')).toHaveCount(0);

  // The retried update is applied in the background and may bring something new to review
  // (a classification): once the knowledge settles, the header shows exactly what the inbox has.
  await knowledgeSettled(person, projectId);
  const after = await inboxOf(person, projectId);
  expect(after.rejected_updates).toHaveLength(0);
  expect(after.total).toBeGreaterThanOrEqual(count);
  if (after.total > 0) await expect(headerCount(page)).toHaveAttribute('data-needs', String(after.total));
  else await expect(headerCount(page)).toHaveCount(0);
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
  const rows = group(page, 'Proposals').locator('[data-need]');
  await expect(rows).toHaveCount(2);

  // 409: the person already accepted it in another tab.
  await person.command(projectId, 'proposal.accept', {}, proposals[0]);
  await rows.filter({ hasText: 'Guests see the catalog' }).getByRole('button', { name: 'Accept', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await confirm.getByRole('button', { name: 'Accept' }).click();
  const conflictReasons = confirm.getByRole('alert');
  await expect(conflictReasons).toContainText("It can't be done right now.");
  await expect(conflictReasons).toContainText('Accepted');
  await expect(page.getByText('Error', { exact: true })).toHaveCount(0);
  await confirm.getByRole('button', { name: 'Not now' }).click();
  await expect(rows.filter({ hasText: 'Guests see the catalog' })).toHaveCount(0);

  // 422: a reason longer than the server takes.
  const second = rows.filter({ hasText: 'Full activities say Full' });
  await second.getByRole('button', { name: 'Reject' }).click();
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
  await tabTo(page, page.getByRole('link', { name: 'Catch up' }), 120);
  await page.keyboard.press('Enter');
  const band = page.getByRole('region', { name: 'Catching up' });
  const progress = band.locator('[data-progress]');
  await expect(progress).toContainText('1 of 3');

  await tabTo(page, band.getByRole('button', { name: 'Skip' }));
  await page.keyboard.press('Enter');
  await expect(progress).toContainText('2 of 3');
  const focus = page.getByRole('main').locator('[data-need]').first();
  await expect(focus).toContainText('Full activities say Full');
  await tabTo(page, focus.getByRole('button', { name: 'Reject' }));
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Reason')).toBeFocused();
  await page.keyboard.type('We keep the number.');
  await tabTo(page, dialog.getByRole('button', { name: 'Reject' }), 5);
  await page.keyboard.press('Enter');
  await expect(progress).toContainText('3 of 3');
  await expect(focus).toHaveAttribute('data-kind', 'version');

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
  const focus = page.getByRole('main').locator('[data-need]').first();

  await expect(progress).toContainText('1 of 5');
  await expect(focus).toHaveAttribute('data-kind', 'conflict');
  await expect(focus).toContainText('DEMIURGO recommends');
  await expect(focus.getByText('To review')).toBeVisible();
  await expect(focus.getByText('The change')).toBeVisible();
  await expectAccessible(page, 'Catch up');
  await band.getByRole('button', { name: 'Skip' }).click();

  await expect(progress).toContainText('2 of 5');
  await expect(focus).toHaveAttribute('data-kind', 'question');
  await expect(focus).toContainText('Can guests sign up without an account?');
  await expect(page.getByRole('region', { name: 'What it unblocks' })).toContainText('Design:');
  await band.getByRole('button', { name: 'Skip' }).click();

  await expect(progress).toContainText('3 of 5');
  await expect(focus).toHaveAttribute('data-kind', 'proposal');
  await expect(focus).toContainText('Guests see the catalog');
  await focus.getByRole('button', { name: 'Reject' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reject' }).click();

  await expect(progress).toContainText('4 of 5');
  await expect(focus).toHaveAttribute('data-kind', 'version');
  await focus.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Approve' }).click();

  await expect(progress).toContainText('5 of 5');
  await expect(focus).toHaveAttribute('data-kind', 'question');
  await expect(focus).toContainText('Who will use the product first');

  // Leave at any time: what was skipped (and not reached) is still in Needs you.
  await band.getByRole('button', { name: 'Leave' }).click();
  await expect(page).not.toHaveURL(/catch-up/);
  await expect(group(page, 'Conflicts')).toBeVisible();
  const questions = group(page, 'Questions');
  await expect(questions).toContainText('Can guests sign up without an account?');
  await expect(questions).toContainText('Who will use the product first');
  await expect(group(page, 'Proposals')).toHaveCount(0);
  await expect(group(page, 'Versions to approve')).toHaveCount(0);
  expect(thread.open).toBeTruthy();
});

test('screens of cut 5: Needs you with every group, Catch up, and Needs you empty', async ({ page, person }) => {
  test.setTimeout(150_000);
  const projectId = await person.createProject('Club Activities');
  await everyKind(person, projectId);
  await page.goto(`/p/${projectId}/needs-you`);
  await expect(group(page, 'Knowledge updates that failed')).toBeVisible();
  await screenshot(page, 5, '01-needs-you');
  await page.getByRole('button', { name: 'Got it' }).click();
  await screenshot(page, 5, '02-needs-you-without-legend');
  await group(page, 'Versions to approve').scrollIntoViewIfNeeded();
  await screenshot(page, 5, '03-needs-you-lower');
  await group(page, 'Knowledge updates that failed').scrollIntoViewIfNeeded();
  await screenshot(page, 5, '04-needs-you-bottom');

  await page.goto(`/p/${projectId}/needs-you?catch-up=1`);
  const band = page.getByRole('region', { name: 'Catching up' });
  await expect(band.locator('[data-progress]')).toContainText('1 of');
  await expect(page.getByRole('main').locator('[data-kind="conflict"]')).toBeVisible();
  await expect(page.getByRole('img', { name: 'may contradict' })).toBeVisible();
  await screenshot(page, 5, '05-catch-up-conflict');
  await band.getByRole('button', { name: 'Skip' }).click();
  await expect(band.locator('[data-progress]')).toContainText('2 of');
  await screenshot(page, 5, '06-catch-up-next');
  await band.getByRole('button', { name: 'Skip' }).click();
  await band.getByRole('button', { name: 'Skip' }).click();
  await expect(band.locator('[data-progress]')).toContainText('4 of');
  await screenshot(page, 5, '07-catch-up-later');

  const empty = await person.createProject('Quiet');
  await decision(person, empty, 'Organizers publish activities', 'Organizers publish activities.');
  await page.goto(`/p/${empty}/needs-you`);
  await expect(page.getByText('Nothing needs you. You can close DEMIURGO.')).toBeVisible();
  await expectAccessible(page, 'Needs you empty');
  await screenshot(page, 5, '08-needs-you-empty');
});
