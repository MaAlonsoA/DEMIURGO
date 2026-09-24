// Runs in a thread (spec §4.7, cut 3): a run in progress in amber that can be cancelled, a failed
// one with its reason and its retry on the same context pack, and Draft it.

import { type PersonApi, expect, expectAccessible, test } from './support/fixtures.ts';

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

  await failed.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('[data-message-by="demiurgo"]').first()).toBeVisible({ timeout: 30_000 });
  // The failed run stays in the thread as retried, without its Retry.
  const retried = page.locator('[data-run-card="retried"]');
  await expect(retried).toBeVisible();
  await expect(retried.getByRole('button', { name: 'Retry' })).toHaveCount(0);

  const runs = await runsOf(person, projectId, id, (r) => r.length === 2 && r.every(finished));
  const original = runs.find((r) => !r.retry_of);
  const retry = runs.find((r) => r.retry_of === original?.id);
  expect(original?.state).toBe('failed');
  expect(retry?.state).toBe('completed');
  expect(retry?.context_pack_hash).toBe(original?.context_pack_hash);

  await retried.getByRole('link', { name: /Details/ }).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${original?.id}$`));
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
