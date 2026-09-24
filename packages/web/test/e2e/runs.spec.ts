// Runs (spec §4.7 and §4.9, cuts 3 and 7): a run in progress in amber that can be cancelled, a
// failed one with its reason and its retry on the same context pack, Draft it, Activity and the
// page of a run.

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

async function legendFolded(page: Page) {
  await page.addInitScript(() => localStorage.setItem('demiurgo:legend', JSON.stringify({ dismissed: true, seen: [] })));
}

test('AC-INT-001-10 a run in progress shows amber with its time and can be cancelled from the thread', async ({
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
  await expect(working).toContainText('DEMIURGO is working…');
  await expect(working.locator('[data-mark="working"]')).toHaveCount(1);
  await expect(working.locator('[data-run-timer]')).toHaveText(/^\d+:\d\d$/);
  await expectAccessible(page, 'a thread with a run in progress');

  await working.getByRole('button', { name: 'Cancel' }).click();
  await expect(working).toBeHidden();
  const cancelled = page.locator('[data-run-card="cancelled"]');
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
  await expect(failed.locator('[data-mark="problem"]')).toHaveCount(1);
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

  // The run pages show the same hash, and link one to the other.
  await retried.getByRole('link', { name: /Details/ }).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${original?.id}$`));
  await expect(page.locator('[data-context-hash]')).toHaveText(original?.context_pack_hash ?? '');
  await page.locator('[data-run-retries]').getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/runs/${retry?.id}$`));
  await expect(page.locator('[data-context-hash]')).toHaveText(original?.context_pack_hash ?? '');
  await expect(page.locator('[data-run-retry-of]').getByRole('link')).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Draft it' })).toBeDisabled();
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

  await expect(page.getByRole('button', { name: 'Draft it' })).toBeEnabled();
  await page.getByRole('button', { name: 'Draft it' }).click();
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
  const rows = page.locator('[data-run-row]');
  await expect(rows).toHaveCount(2);
  await expect(page.locator(`[data-run-row="${bad?.id}"]`)).toContainText('Failed');
  await expect(page.locator(`[data-run-row="${bad?.id}"]`)).toContainText('Conversation');
  await expect(
    page.locator(`[data-run-row="${bad?.id}"]`).getByRole('link', { name: 'Explore the [invalid] output' }),
  ).toBeVisible();
  await expectAccessible(page, 'Activity');

  // The filter by state.
  await page.getByRole('navigation', { name: 'Filter by state' }).getByRole('link', { name: 'Failed' }).click();
  await expect(page).toHaveURL(/\?state=failed$/);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('data-run-row', bad?.id ?? '');
  await page.getByRole('navigation', { name: 'Filter by state' }).getByRole('link', { name: 'Cancelled' }).click();
  await expect(page.getByText('No cancelled runs.')).toBeVisible();

  // The page of the failed run: its reason in words, its context and its events.
  await page.getByRole('navigation', { name: 'Filter by state' }).getByRole('link', { name: 'All' }).click();
  await page.locator(`[data-run-row="${bad?.id}"]`).getByRole('link', { name: 'Conversation' }).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${bad?.id}$`));
  await expect(page.locator('[data-run-status]')).toContainText("It couldn't finish: the output didn't match the format.");
  await expect(page.locator('[data-run-status]')).toContainText('Nothing was changed.');
  await expect(page.locator('[data-context-hash]')).toHaveText(bad?.context_pack_hash ?? '');
  await expect(page.locator('[data-context]')).toContainText('exploration_chat@1');
  const content = page.locator('[data-context-content]');
  await expect(content).not.toHaveAttribute('open');
  await content.locator('summary').click();
  await expect(content).toHaveAttribute('open');
  await expect(page.locator('[data-run-events] li')).not.toHaveCount(0);
  await expect(page.locator('[data-run-events]')).toContainText('Requested');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expectAccessible(page, 'a failed run');

  // A run in progress is cancelled from its page.
  const slow = await openThread(person, projectId, 'Explore the [slow] runner');
  await person.command(projectId, 'message.post', { exploration_id: slow, text: 'Take your time.', respond: true });
  const [running] = await runsOf(person, projectId, slow, (r) => r.length === 1);
  await page.goto(`/p/${projectId}/runs/${running?.id}`);
  await expect(page.locator('[data-run-header]')).toContainText(/Queued|Working/);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('[data-run-header]')).toContainText('Cancelled');
  await expect(page.locator('[data-run-status]')).toContainText('Nothing was changed.');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
});

test('screens of cut 7: Activity and the page of a run', async ({ page, person }) => {
  test.setTimeout(120_000);
  await legendFolded(page);
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
  await runsOf(person, projectId, invalid, (r) => r.length === 1 && r.every(finished));
  const retry = retried.find((r) => r.retry_of === failed?.id);

  await page.goto(`/p/${projectId}/activity`);
  await expect(page.locator('[data-run-row]')).toHaveCount(4);
  await screenshot(page, 7, '01-activity');
  await page.goto(`/p/${projectId}/runs/${failed?.id}`);
  await expect(page.locator('[data-context-hash]')).toBeVisible();
  await expect(page.locator('[data-run-events] li')).not.toHaveCount(0);
  await screenshot(page, 7, '02-run-failed');
  await page.goto(`/p/${projectId}/runs/${retry?.id}`);
  await expect(page.locator('[data-run-retry-of]')).toBeVisible();
  await expect(page.locator('[data-run-events] li')).not.toHaveCount(0);
  await screenshot(page, 7, '03-run-retry');
});
