// Threads and a thread (spec §4.7, cut 3): the list with its nesting, the questions of a thread
// resolved in place, concluding and resuming, writing and asking DEMIURGO, and its observations.

import type { Page } from '@playwright/test';
import { type PersonApi, expect, expectAccessible, screenshot, test } from './support/fixtures.ts';

type Detail = {
  state: string;
  state_reason: string | null;
  messages: { author: string; kind: string | null; body: string; run_id: string | null }[];
  questions: { id: string; state: string; question: string }[];
};
type Run = { id: string; state: string; action: string; batch_id: string | null };

async function openThread(person: PersonApi, projectId: string, purpose: string, extra: Record<string, unknown> = {}) {
  return (await person.command(projectId, 'exploration.open', { purpose, ...extra })).entity_id;
}

async function raise(person: PersonApi, projectId: string, explorationId: string, question: string) {
  return (await person.command(projectId, 'question.raise', { exploration_id: explorationId, question })).entity_id;
}

/** Waits until every run of a thread has finished (the durable engine works in the background). */
function runsSettled(person: PersonApi, projectId: string, explorationId: string, count = 1) {
  return person.until<Run[]>(
    `/api/projects/${projectId}/runs?exploration=${explorationId}`,
    (runs) => runs.length >= count && runs.every((r) => !['queued', 'running'].includes(r.state)),
    45_000,
  );
}

/** The legend folded into its ⓘ, so the screenshots show the screen itself. */
async function legendFolded(page: Page) {
  await page.addInitScript(() => localStorage.setItem('demiurgo:legend', JSON.stringify({ dismissed: true, seen: [] })));
}

const markOf = (page: Page, questionId: string) => page.locator(`[data-question="${questionId}"] [data-mark]`).first();

test('AC-INT-001-09 a thread with questions: answer, park, drop and reopen change each mark at once; concluding leaves it concluded and Resume reopens it', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Thread questions');
  const id = await openThread(person, projectId, 'Design the change set of S3');
  const who = await raise(person, projectId, id, 'Who accepts the map of checks?');
  const where = await raise(person, projectId, id, 'Where do the frozen tests run?');
  const evidence = await raise(person, projectId, id, 'Is the evidence only from the system?');

  await page.goto(`/p/${projectId}/threads/${id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Design the change set of S3' })).toBeVisible();
  await expect(markOf(page, who)).toHaveAttribute('data-mark', 'open');
  await expectAccessible(page, 'a thread with open questions');

  // Answer confirms with the conclusion.
  await page.locator(`[data-question="${who}"]`).getByRole('button', { name: 'Answer' }).click();
  const answer = page.getByRole('dialog', { name: 'Answer the question' });
  await answer.getByLabel('Conclusion').fill('The person accepts it before the tests are frozen.');
  await answer.getByRole('button', { name: 'Answer' }).click();
  await expect(answer).toBeHidden();
  await expect(markOf(page, who)).toHaveAttribute('data-mark', 'confirmed');
  await expect(page.locator(`[data-question="${who}"]`)).toContainText('The person accepts it before the tests are frozen.');

  // Park and Drop ask for a reason.
  await page.locator(`[data-question="${where}"]`).getByRole('button', { name: 'Park' }).click();
  const park = page.getByRole('dialog', { name: 'Park this question' });
  await park.getByLabel('Reason').fill('It depends on the runner, later.');
  await park.getByRole('button', { name: 'Park' }).click();
  await expect(markOf(page, where)).toHaveAttribute('data-mark', 'parked');

  await page.locator(`[data-question="${evidence}"]`).getByRole('button', { name: 'Drop' }).click();
  const drop = page.getByRole('dialog', { name: 'Drop this question' });
  await drop.getByLabel('Reason').fill('Already settled by ADR-EVI-001.');
  await drop.getByRole('button', { name: 'Drop' }).click();
  await expect(markOf(page, evidence)).toHaveAttribute('data-mark', 'dropped');

  // Reopen brings the dropped one back as open.
  await page.locator(`[data-question="${evidence}"]`).getByRole('button', { name: 'Reopen' }).click();
  const reopen = page.getByRole('dialog', { name: 'Reopen this question' });
  await reopen.getByRole('button', { name: 'Reopen' }).click();
  await expect(markOf(page, evidence)).toHaveAttribute('data-mark', 'open');

  // Conclude asks for the conclusion; the thread is concluded and the composer waits for Resume.
  await page.getByRole('button', { name: 'Conclude' }).click();
  const conclude = page.getByRole('dialog', { name: 'Conclude this thread' });
  await conclude.getByLabel('Conclusion').fill('The change set is frozen by the person, the tests run in the runner.');
  await conclude.getByRole('button', { name: 'Conclude' }).click();
  await expect(conclude).toBeHidden();
  const header = page.locator('[data-thread-header]');
  await expect(header.locator('[data-mark]').first()).toHaveAttribute('data-mark', 'confirmed');
  await expect(header).toContainText('Concluded');
  await expect(page.locator('[data-thread-conclusion]')).toContainText('The change set is frozen by the person');
  await expect(page.getByLabel('Message')).toBeDisabled();
  await expect(page.getByText('This thread is concluded. Resume it to continue.')).toBeVisible();
  const concluded = await person.get<Detail>(`/api/projects/${projectId}/explorations/${id}`);
  expect(concluded.state).toBe('concluded');
  expect(concluded.state_reason).toBe('The change set is frozen by the person, the tests run in the runner.');
  await expectAccessible(page, 'a concluded thread');

  await page.getByRole('button', { name: 'Resume' }).first().click();
  await expect(header).toContainText('Active');
  await expect(page.getByLabel('Message')).toBeEnabled();
  expect((await person.get<Detail>(`/api/projects/${projectId}/explorations/${id}`)).state).toBe('active');
});

test('AC-INT-001-09 a new thread opens from the list, Send writes in it, and a thread inside nests under its parent', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('New threads');
  await page.goto(`/p/${projectId}/threads`);
  await expect(page.getByRole('heading', { level: 1, name: 'Threads' })).toBeVisible();
  await expect(page.getByText('No threads yet.')).toBeVisible();
  await expectAccessible(page, 'the empty list of threads');

  await page.getByRole('button', { name: 'New thread' }).click();
  const open = page.getByRole('dialog', { name: 'Open a thread' });
  await open.getByLabel('Purpose').fill('Decide how the runner reports evidence');
  await open.getByRole('button', { name: 'Open thread' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${projectId}/threads/[0-9a-f-]{36}$`));
  const parentId = page.url().split('/').pop() ?? '';
  await expect(page.getByRole('heading', { level: 1, name: 'Decide how the runner reports evidence' })).toBeVisible();

  // Send posts the message without asking DEMIURGO.
  await page.getByLabel('Message').fill('The evidence has to be signed by the runner.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByLabel('Message')).toHaveValue('');
  const mine = page.locator('[data-message-by="you"]');
  await expect(mine).toContainText('The evidence has to be signed by the runner.');
  await expect(mine.locator('[data-who="you"]')).toHaveCount(1);
  const detail = await person.get<Detail>(`/api/projects/${projectId}/explorations/${parentId}`);
  expect(detail.messages.map((m) => m.author)).toEqual(['human:ana']);

  // A thread inside, with its origin.
  await page.getByRole('button', { name: 'New thread inside' }).click();
  const inside = page.getByRole('dialog', { name: 'Open a thread inside' });
  await inside.getByLabel('Purpose').fill('Which signature format?');
  await inside.getByRole('button', { name: 'Open thread' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Which signature format?' })).toBeVisible();
  const provenance = page.locator('[data-thread-provenance]');
  await expect(provenance).toContainText('Inside');
  await expect(provenance.getByRole('link', { name: 'Decide how the runner reports evidence' })).toBeVisible();

  // The list nests the child under its parent.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Threads' }).click();
  const rows = page.locator('[data-thread-row]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Decide how the runner reports evidence');
  await expect(rows.nth(0)).toHaveAttribute('data-depth', '0');
  await expect(rows.nth(1)).toContainText('Which signature format?');
  await expect(rows.nth(1)).toHaveAttribute('data-depth', '1');
  await expectAccessible(page, 'the list of threads');
});

test("AC-INT-001-04 DEMIURGO's observations in a thread carry Proposed or Unknown chips, never Confirmed", async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Observations');
  const id = await openThread(person, projectId, 'Explore how design/ is imported');
  await page.goto(`/p/${projectId}/threads/${id}`);

  // Ask DEMIURGO with a text: the message is posted and the durable response requests the conversation.
  await page.getByLabel('Message').fill('The import has to keep every check as it was written.');
  await page.getByRole('button', { name: 'Ask DEMIURGO' }).click();
  await expect(page.getByLabel('Message')).toHaveValue('');
  const reply = page.locator('[data-message-by="demiurgo"]').first();
  await expect(reply).toBeVisible({ timeout: 30_000 });
  await expect(reply.getByRole('img', { name: 'DEMIURGO · simulated' })).toBeVisible();
  const observation = page.locator('[data-observation]').first();
  await expect(observation).toBeVisible();
  await expect(observation.locator('[data-mark]').first()).toHaveAttribute('data-mark', 'proposed');
  await expect(observation).toContainText('hypothesis');
  await expect(page.locator('[data-message-by="demiurgo"] [data-mark="confirmed"]')).toHaveCount(0);

  // What the API says DEMIURGO observed is what the thread shows.
  const detail = await person.get<Detail>(`/api/projects/${projectId}/explorations/${id}`);
  const observed = detail.messages.filter((m) => m.kind);
  expect(observed.length).toBeGreaterThan(0);
  for (const o of observed) expect(['claim', 'hypothesis', 'unknown']).toContain(o.kind);
  await expect(page.locator('[data-observation]')).toHaveCount(observed.length);
  // DEMIURGO asked a question of its own: it is open, never confirmed.
  const raised = detail.questions[0];
  if (raised) await expect(markOf(page, raised.id)).toHaveAttribute('data-mark', 'open');
  await expectAccessible(page, 'a thread with DEMIURGO');

  // With nothing written, Ask DEMIURGO asks for the conversation to go on: a second answer arrives.
  await page.getByRole('button', { name: 'Ask DEMIURGO' }).click();
  await expect(page.locator('[data-message-by="demiurgo"]')).toHaveCount(2, { timeout: 30_000 });
  await expect(page.locator('[data-message-by="you"]')).toHaveCount(1);
  await expect(page.locator('[data-message-by="demiurgo"] [data-mark="confirmed"]')).toHaveCount(0);
});

test('screens of cut 3: threads, a thread with its questions, the amber run, the rust failure and a draft ready', async ({
  page,
  person,
}) => {
  test.setTimeout(150_000);
  await legendFolded(page);
  const projectId = await person.createProject('DEMIURGO v2');

  // A thread with a conversation and its questions in every state.
  const main = await openThread(person, projectId, 'Design S3: change set and frozen tests');
  await person.command(projectId, 'message.post', {
    exploration_id: main,
    text: 'What does the person accept before the tests are frozen? The map of checks comes first.',
    respond: true,
  });
  await runsSettled(person, projectId, main);
  const who = await raise(person, projectId, main, 'Who accepts the map of checks?');
  const where = await raise(person, projectId, main, 'Do the frozen tests run in the runner?');
  await raise(person, projectId, main, 'Is the evidence only from the system?');
  await person.command(projectId, 'question.confirm', { conclusion: 'The person, before freezing.' }, who);
  await person.command(projectId, 'question.postpone', { reason: 'It depends on the runner.' }, where);
  const child = await openThread(person, projectId, 'Signature of the evidence', { parent_id: main });
  const aside = await openThread(person, projectId, 'Import the v1 backlog');
  await person.command(projectId, 'exploration.set_aside', { reason: 'The v1 is only a reference.' }, aside);
  const done = await openThread(person, projectId, 'Name of the product');
  await person.command(projectId, 'exploration.conclude', { reason: 'It stays DEMIURGO.' }, done);
  void child;

  await page.goto(`/p/${projectId}/threads`);
  await expect(page.locator('[data-thread-row]')).toHaveCount(4);
  await screenshot(page, 3, '01-threads');

  await page.goto(`/p/${projectId}/threads/${main}`);
  await expect(page.locator('[data-observation]').first()).toBeVisible();
  await screenshot(page, 3, '02-thread');

  await page.goto(`/p/${projectId}/threads/${done}`);
  await expect(page.locator('[data-thread-conclusion]')).toBeVisible();
  await screenshot(page, 3, '06-thread-concluded');

  // The amber card while DEMIURGO works.
  const slow = await openThread(person, projectId, 'Explore the runner reports');
  await page.goto(`/p/${projectId}/threads/${slow}`);
  await page.getByLabel('Message').fill('[slow] Look at every report of the runner before answering.');
  await page.getByRole('button', { name: 'Ask DEMIURGO' }).click();
  await expect(page.locator('[data-run-card="working"]')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2200);
  await screenshot(page, 3, '03-run-working');
  await page.locator('[data-run-card="working"]').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('[data-run-card="cancelled"]')).toBeVisible();

  // The rust card when it fails.
  const failing = await openThread(person, projectId, 'Explore the evidence format');
  await page.goto(`/p/${projectId}/threads/${failing}`);
  await page.getByLabel('Message').fill('[fail-once] Which fields does every piece of evidence carry?');
  await page.getByRole('button', { name: 'Ask DEMIURGO' }).click();
  await expect(page.locator('[data-run-card="failed"]')).toBeVisible({ timeout: 30_000 });
  await screenshot(page, 3, '04-run-failed');

  // A decision born in the thread, approved; Draft it; the package arrives.
  const drafting = await openThread(person, projectId, 'Design the frozen tests');
  await person.command(projectId, 'message.post', {
    exploration_id: drafting,
    text: "We'll use a map of checks that the person accepts before the tests are frozen.",
    respond: true,
  });
  await runsSettled(person, projectId, drafting);
  const inbox = await person.until<{ batches: { proposals: { id: string; type: string }[] }[] }>(
    `/api/projects/${projectId}/inbox`,
    (i) => i.batches.some((b) => b.proposals.some((p) => p.type === 'decision')),
  );
  const decision = inbox.batches.flatMap((b) => b.proposals).find((p) => p.type === 'decision');
  await person.command(projectId, 'proposal.accept', { approve: true }, decision?.id);
  await person.until<{ up_to_date: boolean; updates_in_progress: number }>(
    `/api/projects/${projectId}/knowledge`,
    (k) => k.up_to_date && k.updates_in_progress === 0,
  );
  await page.goto(`/p/${projectId}/threads/${drafting}`);
  await page.getByRole('button', { name: 'Draft it' }).click();
  await page.getByRole('menuitem').filter({ hasText: 'From this thread' }).click();
  await expect(page.locator('[data-run-card="draft"]')).toBeVisible({ timeout: 45_000 });
  await screenshot(page, 3, '05-draft-ready');
});
