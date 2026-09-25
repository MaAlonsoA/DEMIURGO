// Runs (DESIGN.md §3.4, §4.2; spec §4.7 and §4.9, cuts 3 and 7): a run in progress that can be
// cancelled, a failed one with its reason and its retry on the same context pack, Draft it,
// Activity (Right now, the filter by state, the whole row opening the run) and the page of a run
// (status first, phases, tabs Engine calls · Context · Output · Events, attempts, Cancel that
// confirms and says what is kept).

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { type PersonApi, expect, expectAccessible, screenshot, test } from './support/fixtures.ts';

type Run = {
  id: string;
  state: string;
  action: string;
  retry_of: string | null;
  failure_kind: string | null;
  context_pack_hash: string | null;
  exploration_id: string | null;
  batch_id: string | null;
};

async function openThread(person: PersonApi, projectId: string, purpose: string) {
  return (await person.command(projectId, 'exploration.open', { purpose })).entity_id;
}

function runsOf(person: PersonApi, projectId: string, explorationId: string, done: (runs: Run[]) => boolean) {
  return person.until<Run[]>(`/api/projects/${projectId}/runs?exploration=${explorationId}`, done, 45_000);
}

const finished = (r: Run) => !['queued', 'running'].includes(r.state);

/**
 * The transition stylesheet (D-017) still pins html and body to 1280 px; until it goes, the reflow
 * checks lift that pin to see how these screens themselves behave at a phone's width.
 */
async function withoutLegacyMinWidth(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'html, body { min-width: 0 !important; }';
      document.head.append(style);
    });
  });
}

/** A check screenshot for the rebuild's visual review, only when E2E_SHOTS names a folder. */
async function shot(page: Page, name: string) {
  const dir = process.env.E2E_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}

/** A Cancel that asks first: confirm it when the confirmation shows (the run card may not ask). */
async function confirmIfAsked(page: Page, after: ReturnType<Page['locator']>) {
  const dialog = page.getByRole('alertdialog');
  await dialog.or(after).first().waitFor();
  if (await dialog.isVisible()) await dialog.locator('[data-confirm]').click();
}

test('AC-INT-001-10 a run in progress shows that it works, with its time, and can be cancelled from the thread', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Run in progress');
  const id = await openThread(person, projectId, 'Explore the runner reports');
  await page.goto(`/p/${projectId}/threads/${id}`);

  await page.getByLabel('Message').fill('[slow] Look at every report before answering.');
  await page.getByRole('button', { name: 'Ask DEMIURGO' }).click();
  const working = page.locator('[data-run-card="working"]');
  await expect(working).toBeVisible({ timeout: 30_000 });
  await expect(working.locator('[data-status="working"]').first()).toBeVisible();
  await expect(working.locator('[data-run-timer]')).toHaveText(/\d+:\d\d/);
  await expectAccessible(page, 'a thread with a run in progress');

  await working.getByRole('button', { name: 'Cancel' }).click();
  const cancelled = page.locator('[data-run-card="cancelled"]');
  await confirmIfAsked(page, cancelled);
  await expect(working).toBeHidden();
  await expect(cancelled).toBeVisible();
  await expect(cancelled).toContainText('Cancelled');
  const runs = await runsOf(person, projectId, id, (r) => r.length === 1 && r.every(finished));
  expect(runs[0]?.state).toBe('cancelled');
});

test('AC-INT-001-10 a failed run shows its reason in product words and Retry runs again on the same context pack', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Failed run');
  const id = await openThread(person, projectId, 'Explore the evidence format');
  await page.goto(`/p/${projectId}/threads/${id}`);

  await page.getByLabel('Message').fill('[fail-once] Which fields does every piece of evidence carry?');
  await page.getByRole('button', { name: 'Ask DEMIURGO' }).click();
  const failed = page.locator('[data-run-card="failed"]');
  await expect(failed).toBeVisible({ timeout: 30_000 });
  await expect(failed).toContainText('The agent answered with an error. Nothing was changed.');
  await expect(failed.locator('[data-status="problem"]').first()).toBeVisible();
  await expect(failed).not.toContainText(/^Error$/);
  await expectAccessible(page, 'a thread with a failed run');

  await failed.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('[data-message-by="demiurgo"]').first()).toBeVisible({ timeout: 30_000 });
  // The failed run stays in the thread as retried, without its Retry.
  const retried = page.locator('[data-run-card="retried"]');
  await expect(retried).toBeVisible();
  await expect(retried.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);

  const runs = await runsOf(person, projectId, id, (r) => r.length === 2 && r.every(finished));
  const original = runs.find((r) => !r.retry_of);
  const retry = runs.find((r) => r.retry_of === original?.id);
  expect(original?.state).toBe('failed');
  expect(retry?.state).toBe('completed');
  expect(retry?.context_pack_hash).toBe(original?.context_pack_hash);

  // The run pages show the same hash in their Context, and list both as attempts linking each other.
  await retried.getByRole('link', { name: /Details/ }).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${original?.id}$`));
  await page.getByRole('tab', { name: 'Context' }).click();
  await expect(page.locator('[data-context-hash]')).toHaveText(original?.context_pack_hash ?? '');
  const attempts = page.getByRole('complementary', { name: 'Details' });
  await expect(attempts.getByText('Attempt 1')).toBeVisible();
  await page.locator('[data-run-retries]').getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/runs/${retry?.id}$`));
  await page.getByRole('tab', { name: 'Context' }).click();
  await expect(page.locator('[data-context-hash]')).toHaveText(original?.context_pack_hash ?? '');
  await expect(page.locator('[data-run-retry-of]').getByRole('link')).toBeVisible();
  await expect(attempts.locator('[aria-current="true"]')).toContainText('Attempt 2');
});

test('AC-INT-001-10 Draft it asks DEMIURGO for a design from the decision born in the thread, and the thread shows the draft ready', async ({
  page,
  person,
}) => {
  test.setTimeout(120_000);
  const projectId = await person.createProject('Draft it');
  const id = await openThread(person, projectId, 'Design the frozen tests');
  await page.goto(`/p/${projectId}/threads/${id}`);
  // Without an approved decision there is nothing to draft from.
  await expect(page.getByRole('button', { name: 'Draft it', exact: true })).toBeDisabled();
  await expect(page.getByText('Draft it needs an approved decision first.')).toBeVisible();

  // The person decides in the thread; DEMIURGO proposes the decision; the person accepts and approves it.
  await page.getByLabel('Message').fill("We'll use a map of checks that the person accepts before the tests are frozen.");
  await page.getByRole('button', { name: 'Ask DEMIURGO' }).click();
  await runsOf(person, projectId, id, (r) => r.length === 1 && r.every(finished));
  const inbox = await person.until<{ batches: { proposals: { id: string; type: string }[] }[] }>(
    `/api/projects/${projectId}/inbox`,
    (i) => i.batches.some((b) => b.proposals.some((p) => p.type === 'decision')),
  );
  const decision = inbox.batches.flatMap((b) => b.proposals).find((p) => p.type === 'decision');
  // The conversation says what it proposed, and where to review it.
  const proposed = page.locator('[data-message-by="demiurgo"] [data-proposed]');
  await expect(proposed).toContainText('Proposed 1 decision for you to review.');
  await expect(proposed.getByRole('link', { name: /Review/ })).toBeVisible();
  const accepted = await person.command<{ code: string }>(projectId, 'proposal.accept', { approve: true }, decision?.id);
  await person.until<{ up_to_date: boolean; updates_in_progress: number }>(
    `/api/projects/${projectId}/knowledge`,
    (k) => k.up_to_date && k.updates_in_progress === 0,
  );
  await expect(proposed).not.toContainText('for you to review');

  await expect(page.getByRole('button', { name: 'Draft it', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Draft it', exact: true }).click();
  const item = page.getByRole('menuitem').filter({ hasText: accepted.result?.code ?? '' });
  await expect(item).toContainText('From this thread');
  await item.click();

  const ready = page.locator('[data-run-card="draft"]');
  await expect(ready).toBeVisible({ timeout: 45_000 });
  await expect(ready).toContainText('A draft is ready:');
  await expect(ready).toContainText('with 2 checks');
  const runs = await runsOf(person, projectId, id, (r) => r.some((x) => x.action === 'design_proposal' && finished(x)));
  const draft = runs.find((r) => r.action === 'design_proposal');
  expect(draft?.state).toBe('completed');
  await expectAccessible(page, 'a thread with a draft ready');
  await ready.getByRole('link', { name: /Review/ }).click();
  await expect(page).toHaveURL(new RegExp(`/batches/${draft?.batch_id}$`));
});

test('AC-INT-001-10 Activity lists the runs with their state and filters them; a run page explains an invalid output and cancels a run', async ({
  page,
  person,
}) => {
  test.setTimeout(120_000);
  const projectId = await person.createProject('Activity');
  const talk = await openThread(person, projectId, 'Explore the release notes');
  await person.command(projectId, 'message.post', { exploration_id: talk, text: 'Keep them short.', respond: true });
  const invalid = await openThread(person, projectId, 'Explore the [invalid] output');
  await person.command(projectId, 'message.post', { exploration_id: invalid, text: 'Answer anything.', respond: true });
  await runsOf(person, projectId, talk, (r) => r.length === 1 && r.every(finished));
  const [bad] = await runsOf(person, projectId, invalid, (r) => r.length === 1 && r.every(finished));
  expect(bad?.failure_kind).toBe('invalid_output');

  await page.goto(`/p/${projectId}/activity`);
  await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
  await expect(page.locator('[data-activity-summary]')).toHaveText('2 runs of DEMIURGO · 1 failed (not retried)');
  const rows = page.locator('[data-run-row]');
  await expect(rows).toHaveCount(2);
  const badRow = page.locator(`[data-run-row="${bad?.id}"]`);
  await expect(badRow).toContainText('Failed');
  await expect(badRow).toContainText('Conversation');
  await expect(badRow).toContainText("It couldn't finish: the output didn't match the format.");
  await expect(badRow.getByRole('link', { name: 'Explore the [invalid] output' })).toBeVisible();
  // Nothing works now: there is no "Right now".
  await expect(page.locator('[data-right-now]')).toHaveCount(0);
  await expectAccessible(page, 'Activity');

  // The filter by state: links with their counts in text.
  const filter = page.getByRole('navigation', { name: 'Filter by state' });
  await expect(filter.getByRole('link', { name: 'Failed' })).toHaveText(/Failed\s*1/);
  await filter.getByRole('link', { name: 'Failed' }).click();
  await expect(page).toHaveURL(/\?state=failed$/);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('data-run-row', bad?.id ?? '');
  await filter.getByRole('link', { name: 'Cancelled' }).click();
  await expect(page.getByText('No cancelled runs.')).toBeVisible();

  // The whole row opens the page of the failed run: its reason in words, its context and its events.
  await filter.getByRole('link', { name: 'All' }).click();
  await expect(badRow.getByRole('link', { name: 'Conversation' })).toBeVisible();
  await badRow.locator('td').last().click();
  await expect(page).toHaveURL(new RegExp(`/runs/${bad?.id}$`));
  const status = page.locator('[data-run-status]');
  await expect(status).toContainText("It couldn't finish: the output didn't match the format.");
  await expect(status).toContainText('Nothing was changed.');
  await expect(status).toContainText('another engine');
  await expect(page.locator('[data-phase="result"]')).toHaveAttribute('data-phase-state', 'stopped');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry with…' })).toBeVisible();
  await expectAccessible(page, 'a failed run');

  await page.getByRole('tab', { name: 'Context' }).click();
  await expect(page.locator('[data-context-hash]')).toHaveText(bad?.context_pack_hash ?? '');
  await expect(page.locator('[data-context]')).toContainText('exploration_chat@2');
  const content = page.locator('[data-context-content]');
  await expect(content).not.toHaveAttribute('open');
  await content.locator('summary').first().click();
  await expect(content).toHaveAttribute('open');
  await expect(content).toContainText('Explore the [invalid] output');
  await page.getByRole('tab', { name: 'Events' }).click();
  await expect(page.locator('[data-run-events] li')).not.toHaveCount(0);
  await expect(page.locator('[data-run-events]')).toContainText('Requested');
  await expectAccessible(page, 'the events of a failed run');

  // A run in progress shows in Right now, and is cancelled from its page, which says what is kept.
  const slow = await openThread(person, projectId, 'Explore the [slow] runner');
  await person.command(projectId, 'message.post', { exploration_id: slow, text: 'Take your time.', respond: true });
  const [running] = await runsOf(person, projectId, slow, (r) => r.length === 1);
  await page.goto(`/p/${projectId}/activity`);
  const now = page.locator(`[data-right-now="${running?.id}"]`);
  await expect(now).toBeVisible();
  await expect(now).toContainText(/Queued|Working|Late|Stalled/);
  await now.getByRole('link', { name: /Open the run/ }).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${running?.id}$`));
  await expect(page.locator('[data-run-header]')).toContainText(/Queued|Working/);
  await expect(page.locator('[data-run-status]')).toContainText(/Waiting to start|DEMIURGO is working/);
  await expectAccessible(page, 'a run in progress');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Nothing is applied; what it already wrote in the thread stays.');
  await confirm.getByRole('button', { name: 'Cancel the run' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.locator('[data-run-header]')).toContainText('Cancelled');
  await expect(page.locator('[data-run-status]')).toContainText('Nothing was changed.');
  await expect(page.locator('[data-run-status]')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
});

test('screens of cut 7: Activity and the page of a run', async ({ page, person }) => {
  test.setTimeout(150_000);
  const projectId = await person.createProject('DEMIURGO v2');
  const talk = await openThread(person, projectId, 'Design S3: change set and frozen tests');
  await person.command(projectId, 'message.post', {
    exploration_id: talk,
    text: 'Who accepts the map of checks?',
    respond: true,
  });
  const failing = await openThread(person, projectId, 'Explore the evidence format');
  await person.command(projectId, 'message.post', { exploration_id: failing, text: '[fail-once] Which fields?', respond: true });
  const invalid = await openThread(person, projectId, 'Explore the [invalid] output');
  await person.command(projectId, 'message.post', { exploration_id: invalid, text: 'Answer anything.', respond: true });
  await runsOf(person, projectId, talk, (r) => r.length === 1 && r.every(finished));
  const [failed] = await runsOf(person, projectId, failing, (r) => r.length === 1 && r.every(finished));
  await person.command(projectId, 'run.retry', { run_id: failed?.id });
  const retried = await runsOf(person, projectId, failing, (r) => r.length === 2 && r.every(finished));
  const [bad] = await runsOf(person, projectId, invalid, (r) => r.length === 1 && r.every(finished));
  const retry = retried.find((r) => r.retry_of === failed?.id);
  const slow = await openThread(person, projectId, 'Explore the [slow] runner');
  await person.command(projectId, 'message.post', { exploration_id: slow, text: 'Take your time.', respond: true });
  const [running] = await runsOf(person, projectId, slow, (r) => r.length === 1 && r[0]?.state === 'running');

  await page.goto(`/p/${projectId}/activity`);
  await expect(page.locator('[data-run-row]')).toHaveCount(5);
  await expect(page.locator('[data-right-now]')).toHaveCount(1);
  await screenshot(page, 7, '01-activity');
  await shot(page, 'activity');
  await page.getByRole('button', { name: 'Show per part' }).click();
  await shot(page, 'activity-usage-open');

  await page.goto(`/p/${projectId}/runs/${failed?.id}`);
  await expect(page.locator('[data-run-status]')).toBeVisible();
  await screenshot(page, 7, '02-run-failed');
  await shot(page, 'run-failed');
  await page.getByRole('tab', { name: 'Events' }).click();
  await expect(page.locator('[data-run-events] li')).not.toHaveCount(0);
  await shot(page, 'run-failed-events');

  await page.goto(`/p/${projectId}/runs/${retry?.id}`);
  await expect(page.locator('[data-run-retry-of]')).toBeVisible();
  await screenshot(page, 7, '03-run-retry');
  await shot(page, 'run-retry');
  await page.getByRole('tab', { name: 'Output' }).click();
  await expect(page.locator('[data-run-output]')).toBeVisible();
  await shot(page, 'run-retry-output');
  await page.getByRole('tab', { name: 'Context' }).click();
  await page.locator('[data-context-content] summary').first().click();
  await shot(page, 'run-retry-context');

  await page.goto(`/p/${projectId}/runs/${bad?.id}`);
  await page.getByRole('tab', { name: 'Engine calls' }).click();
  await shot(page, 'run-invalid-calls');

  await page.goto(`/p/${projectId}/runs/${running?.id}`);
  await expect(page.locator('[data-run-status]')).toContainText('DEMIURGO is working');
  await shot(page, 'run-working');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await shot(page, 'run-cancel-confirm');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Keep it running' }).click();

  // Reflow at a phone's width.
  await withoutLegacyMinWidth(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/p/${projectId}/activity`);
  await expect(page.locator('[data-run-row]')).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, 'activity-390');
  await page.goto(`/p/${projectId}/runs/${failed?.id}`);
  await expect(page.locator('[data-run-status]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, 'run-failed-390');
});
