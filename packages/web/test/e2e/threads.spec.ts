// Threads and a thread (DESIGN.md §3.3, J2): the list as a tree with its filter and its error state,
// questions answered in place as drafts confirmed together, Park, Drop and Reopen from each
// question's menu, concluding and resuming, the composer's keys (D-013), DEMIURGO's observations, Go
// deeper, a design stage passed from its thread, and the screens of cut 3.

import type { Page } from '@playwright/test';
import { type PersonApi, expect, expectAccessible, screenshot, test } from './support/fixtures.ts';

type Detail = {
  state: string;
  state_reason: string | null;
  messages: { author: string; kind: string | null; body: string; run_id: string | null; question_id: string | null }[];
  questions: { id: string; state: string; question: string; shown_at: string | null }[];
};
type Run = { id: string; state: string; action: string; batch_id: string | null };

/** Where the review screenshots of this group go (the rebuild's visual check). */
const SHOTS = process.env.E2E_SHOTS ?? '';

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function openThread(person: PersonApi, projectId: string, purpose: string, extra: Record<string, unknown> = {}) {
  return (await person.command(projectId, 'exploration.open', { purpose, ...extra })).entity_id;
}

/**
 * The first root thread a person opens carries the design stages and their questions: tests that
 * need a thread without them open this one first.
 */
async function mainThread(person: PersonApi, projectId: string) {
  return openThread(person, projectId, 'The product');
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

const detailOf = (person: PersonApi, projectId: string, id: string) =>
  person.get<Detail>(`/api/projects/${projectId}/explorations/${id}`);

const card = (page: Page, questionId: string) => page.locator(`[data-question="${questionId}"]`);
const statusOf = (page: Page, questionId: string) => card(page, questionId).locator('[data-status]').first();

/** Park, Drop or Reopen from the question's "More actions" menu (D-012). */
async function fromMenu(page: Page, questionId: string, item: 'Park…' | 'Drop…' | 'Reopen…') {
  await card(page, questionId).getByRole('button', { name: 'More actions for this question' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test("AC-INT-001-09 a thread with questions: an answer in the person's words is a draft until sent; park, drop and reopen from each question's menu; concluding leaves it concluded and Resume reopens it", async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Thread questions');
  await mainThread(person, projectId);
  const id = await openThread(person, projectId, 'Design the change set of S3');
  const who = await raise(person, projectId, id, 'Who accepts the map of checks?');
  const where = await raise(person, projectId, id, 'Where do the frozen tests run?');
  const evidence = await raise(person, projectId, id, 'Is the evidence only from the system?');

  await page.goto(`/p/${projectId}/threads/${id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Design the change set of S3' })).toBeVisible();
  await expect(statusOf(page, who)).toHaveAttribute('data-status', 'open');
  await expect(page.getByRole('complementary', { name: 'In this thread' })).toContainText('3 open · 0 settled');
  await expectAccessible(page, 'a thread with open questions');

  // "Answer in my own words": the composer says which question it answers; Enter keeps it as a draft.
  await card(page, who).getByRole('button', { name: 'Answer in my own words' }).click();
  const message = page.getByLabel('Message');
  await expect(message).toBeFocused();
  await expect(page.locator('[data-answering]')).toContainText('Who accepts the map of checks?');
  await message.fill('The person accepts it before the tests are frozen.');
  await message.press('Enter');
  await expect(page.locator('[data-answering]')).toHaveCount(0);
  await expect(card(page, who)).toHaveAttribute('data-draft', 'true');
  await expect(card(page, who)).toContainText('Your answer: The person accepts it before the tests are frozen.');
  await expect(card(page, who)).toContainText('Not sent yet');
  const bar = page.locator('[data-drafts-bar]');
  await expect(bar).toContainText('1 of 3 answers ready.');
  await shot(page, '11-drafts-bar');
  // Nothing reached the server yet.
  expect((await detailOf(person, projectId, id)).questions.find((q) => q.id === who)?.state).toBe('pending');
  await expectAccessible(page, 'a thread with a draft answer');

  await bar.getByRole('button', { name: 'Confirm and send' }).click();
  await expect(statusOf(page, who)).toHaveAttribute('data-status', 'confirmed');
  await expect(card(page, who)).toContainText('The person accepts it before the tests are frozen.');
  await expect(bar).toHaveCount(0);
  await expect(message).toBeFocused();

  // Park and Drop ask for a reason, from the question's menu.
  await fromMenu(page, where, 'Park…');
  const park = page.getByRole('dialog', { name: 'Park this question' });
  await park.getByLabel('Reason').fill('It depends on the runner, later.');
  await park.getByRole('button', { name: 'Park' }).click();
  await expect(statusOf(page, where)).toHaveAttribute('data-status', 'parked');
  await expect(card(page, where)).toContainText('It depends on the runner, later.');

  await fromMenu(page, evidence, 'Drop…');
  const drop = page.getByRole('dialog', { name: 'Drop this question' });
  await drop.getByLabel('Reason').fill('Already settled by ADR-EVI-001.');
  await drop.getByRole('button', { name: 'Drop' }).click();
  await expect(statusOf(page, evidence)).toHaveAttribute('data-status', 'dropped');

  // Reopen brings the dropped one back as open.
  await fromMenu(page, evidence, 'Reopen…');
  const reopen = page.getByRole('dialog', { name: 'Reopen this question' });
  await reopen.getByRole('button', { name: 'Reopen' }).click();
  await expect(statusOf(page, evidence)).toHaveAttribute('data-status', 'open');

  // Conclude asks for the conclusion; the thread is concluded and the composer waits for Resume.
  await page.getByRole('button', { name: 'Conclude' }).click();
  const conclude = page.getByRole('dialog', { name: 'Conclude this thread' });
  await conclude.getByLabel('Conclusion').fill('The change set is frozen by the person, the tests run in the runner.');
  await conclude.getByRole('button', { name: 'Conclude' }).click();
  await expect(conclude).toBeHidden();
  const header = page.locator('[data-thread-header]');
  await expect(header.locator('[data-thread-state] [data-status]')).toHaveAttribute('data-status', 'confirmed');
  await expect(header).toContainText('Concluded');
  await expect(page.locator('[data-thread-conclusion]')).toContainText('The change set is frozen by the person');
  await expect(message).toBeDisabled();
  await expect(page.getByText('This thread is concluded. Resume it to continue.')).toBeVisible();
  const concluded = await detailOf(person, projectId, id);
  expect(concluded.state).toBe('concluded');
  expect(concluded.state_reason).toBe('The change set is frozen by the person, the tests run in the runner.');
  await expectAccessible(page, 'a concluded thread');

  await page.getByRole('button', { name: 'Resume' }).first().click();
  await expect(header).toContainText('Active');
  await expect(message).toBeEnabled();
  expect((await detailOf(person, projectId, id)).state).toBe('active');
});

test('AC-INT-001-09 a new thread opens from the list, Enter and Send write in it, and a thread inside nests under its parent in the tree', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('New threads');
  await page.goto(`/p/${projectId}/threads`);
  await expect(page.getByRole('heading', { level: 1, name: 'Threads' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No threads yet' })).toBeVisible();
  await expectAccessible(page, 'the empty list of threads');
  await shot(page, '14-threads-empty');

  await page.getByRole('button', { name: 'New thread', exact: true }).first().click();
  const open = page.getByRole('dialog', { name: 'Open a thread' });
  await open.getByLabel('Purpose').fill('Decide how the runner reports evidence');
  await open.getByRole('button', { name: 'Open thread' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${projectId}/threads/[0-9a-f-]{36}$`));
  const parentId = page.url().split('/').pop() ?? '';
  await expect(page.getByRole('heading', { level: 1, name: 'Decide how the runner reports evidence' })).toBeVisible();

  // Shift+Enter adds a line; Enter sends without asking DEMIURGO, and the field keeps the focus.
  const message = page.getByLabel('Message');
  await expect(page.getByText(/Enter sends · Shift\+Enter adds a line/)).toBeVisible();
  await message.fill('The evidence has to be signed by the runner.');
  await message.press('Shift+Enter');
  await message.pressSequentially('Every piece of it.');
  await expect(message).toHaveValue('The evidence has to be signed by the runner.\nEvery piece of it.');
  await message.press('Enter');
  await expect(message).toHaveValue('');
  await expect(message).toBeFocused();
  const mine = page.locator('[data-message-by="you"]');
  await expect(mine).toContainText('Every piece of it.');
  await expect(mine.locator('[data-who="you"]')).toHaveCount(1);

  // The Send button does the same, and the focus comes back to the field.
  await message.fill('It is kept for a year.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(message).toHaveValue('');
  await expect(mine).toHaveCount(2);
  await expect(message).toBeFocused();
  const detail = await detailOf(person, projectId, parentId);
  expect(detail.messages.map((m) => m.author)).toEqual(['human:ana', 'human:ana']);

  // A thread inside, with its origin.
  await page.getByRole('button', { name: 'New thread inside' }).click();
  const inside = page.getByRole('dialog', { name: 'Open a thread inside' });
  await inside.getByLabel('Purpose').fill('Which signature format?');
  await inside.getByRole('button', { name: 'Open thread' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Which signature format?' })).toBeVisible();
  // Text typed in one thread never shows up in another.
  await expect(page.getByLabel('Message')).toHaveValue('');
  const provenance = page.locator('[data-thread-provenance]');
  await expect(provenance).toContainText('Inside');
  await expect(provenance.getByRole('link', { name: 'Decide how the runner reports evidence' })).toBeVisible();

  // The list nests the child under its parent, as a tree.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Threads' }).click();
  const tree = page.getByRole('treegrid', { name: 'Threads' });
  const rows = page.locator('[data-thread-row]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Decide how the runner reports evidence');
  await expect(rows.nth(0)).toHaveAttribute('data-depth', '0');
  await expect(rows.nth(0)).toHaveAttribute('aria-level', '1');
  await expect(rows.nth(0)).toHaveAttribute('aria-expanded', 'true');
  await expect(rows.nth(1)).toContainText('Which signature format?');
  await expect(rows.nth(1)).toHaveAttribute('data-depth', '1');
  await expect(rows.nth(1)).toHaveAttribute('aria-level', '2');
  await expectAccessible(page, 'the list of threads');

  // Arrow keys: Left hides the threads inside, Right shows them, Down moves, Enter opens.
  await rows.nth(0).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowRight');
  await expect(rows).toHaveCount(2);
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await shot(page, '16-threads-keyboard');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Which signature format?' })).toBeVisible();

  // The state filter narrows what is loaded.
  await page.goBack();
  await expect(tree).toBeVisible();
  await page
    .getByRole('radiogroup', { name: 'Show threads' })
    .getByRole('radio', { name: /Concluded/ })
    .click();
  await expect(page.getByRole('heading', { name: 'No concluded threads' })).toBeVisible();
  await page.getByRole('button', { name: 'Show all threads' }).click();
  await expect(rows).toHaveCount(2);
});

test('AC-INT-001-09 the list of threads says when it could not load and Retry loads it; a thread that is not there says so', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Errors');
  const list = `**/api/projects/${projectId}/explorations`;
  await page.route(list, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
  await page.goto(`/p/${projectId}/threads`);
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No threads yet' })).toHaveCount(0);
  await expectAccessible(page, 'the list of threads that failed to load');
  await shot(page, '15-threads-error');
  await page.unroute(list);
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'No threads yet' })).toBeVisible();

  await page.goto(`/p/${projectId}/threads/00000000-0000-4000-8000-000000000000`);
  await expect(page.getByRole('heading', { level: 1, name: "We couldn't find this thread." })).toBeVisible();
  await expect(page.getByText('It may belong to another project.')).toBeVisible();
  await expectAccessible(page, 'a thread that is not there');
});

test("AC-INT-001-04 DEMIURGO's observations in a thread carry Proposed or Unknown chips, never Confirmed", async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Observations');
  await mainThread(person, projectId);
  const id = await openThread(person, projectId, 'Explore how design/ is imported');
  await page.goto(`/p/${projectId}/threads/${id}`);

  // Ctrl+Enter asks DEMIURGO: the message is posted and the durable response requests the conversation.
  const message = page.getByLabel('Message');
  await message.fill('The import has to keep every check as it was written.');
  await message.press('Control+Enter');
  await expect(message).toHaveValue('');
  const reply = page.locator('[data-message-by="demiurgo"]').first();
  await expect(reply).toBeVisible({ timeout: 30_000 });
  await expect(reply.locator('[data-who="demiurgo"]')).toHaveCount(1);
  await expect(reply.locator('header')).toContainText('DEMIURGO');
  await expect(reply.locator('header')).toContainText('simulated');
  const observation = page.locator('[data-observation]').first();
  await expect(observation).toBeVisible();
  await expect(observation.locator('[data-status]').first()).toHaveAttribute('data-status', 'proposed');
  await expect(observation).toContainText(/hypothesis/i);
  await expect(page.locator('[data-message-by="demiurgo"] [data-status="confirmed"]')).toHaveCount(0);

  // What the API says DEMIURGO observed is what the thread shows.
  const detail = await detailOf(person, projectId, id);
  const observed = detail.messages.filter((m) => m.kind);
  expect(observed.length).toBeGreaterThan(0);
  for (const o of observed) expect(['claim', 'hypothesis', 'unknown']).toContain(o.kind);
  await expect(page.locator('[data-observation]')).toHaveCount(observed.length);
  // DEMIURGO asked a question of its own: it is open, never confirmed.
  const raised = detail.questions[0];
  if (raised) await expect(statusOf(page, raised.id)).toHaveAttribute('data-status', 'open');
  await expectAccessible(page, 'a thread with DEMIURGO');

  // With nothing written, Ask DEMIURGO asks for the conversation to go on: a second answer arrives.
  await page.getByRole('button', { name: 'Ask DEMIURGO' }).click();
  await expect(page.locator('[data-message-by="demiurgo"]')).toHaveCount(2, { timeout: 30_000 });
  await expect(page.locator('[data-message-by="you"]')).toHaveCount(1);
  await expect(page.locator('[data-message-by="demiurgo"] [data-status="confirmed"]')).toHaveCount(0);
});

test("AC-INT-001-09 DEMIURGO's question: an option drafts the answer and survives a reload, Go deeper talks it through and settles it, and Confirm and send lets DEMIURGO go on", async ({
  page,
  person,
}) => {
  test.setTimeout(120_000);
  const projectId = await person.createProject('Guided questions');
  // The first thread carries the design stages: DEMIURGO's first reply shows two of their questions,
  // with the options it suggests.
  const id = await openThread(person, projectId, 'Explore who uses the product');
  await person.command(projectId, 'message.post', {
    exploration_id: id,
    text: 'A tool to plan community events.',
    respond: true,
  });
  await runsSettled(person, projectId, id);
  const asked = (await detailOf(person, projectId, id)).questions.find((q) => q.shown_at && q.state === 'pending');
  if (!asked) throw new Error('DEMIURGO showed no question.');

  await page.goto(`/p/${projectId}/threads/${id}`);
  const question = card(page, asked.id);
  const options = question.getByRole('group', { name: 'Pick one' });
  await expect(options.getByRole('radio')).toHaveCount(2);
  await options.getByRole('radio', { name: /Not for now/ }).check();
  await expect(question).toHaveAttribute('data-draft', 'true');
  await expect(question).toContainText('Not sent yet');
  await expectAccessible(page, "DEMIURGO's question with a picked option");

  // The drafts are kept in this browser: a reload keeps the choice, still unsent.
  await page.reload();
  await expect(options.getByRole('radio', { name: /Not for now/ })).toBeChecked();
  await expect(page.locator('[data-drafts-bar]')).toContainText('1 of 2 answers ready.');
  expect((await detailOf(person, projectId, id)).questions.find((q) => q.id === asked.id)?.state).toBe('pending');

  // Go deeper replaces the side panel; its question takes the focus; Esc closes it and gives the focus back.
  const deeperButton = question.getByRole('button', { name: /Go deeper/ });
  await deeperButton.click();
  const panel = page.getByRole('complementary', { name: 'Go deeper' });
  await expect(panel.getByRole('heading', { level: 2, name: asked.question })).toBeFocused();
  await expect(question.getByRole('button', { name: /Going deeper/ })).toHaveAttribute('aria-expanded', 'true');
  await expectAccessible(page, 'Go deeper');
  const separator = page.getByRole('separator', { name: 'Resize Go deeper' });
  const width = Number(await separator.getAttribute('aria-valuenow'));
  await separator.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(separator).toHaveAttribute('aria-valuenow', String(width + 32));
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(deeperButton).toBeFocused();

  // Talking it through: Enter sends, DEMIURGO answers in the side conversation, not in the thread.
  await deeperButton.click();
  const talk = panel.getByLabel('Talk it through');
  await talk.fill('What changes if it stays out for now?');
  await talk.press('Enter');
  await expect(talk).toHaveValue('');
  const useReply = panel.getByRole('button', { name: 'Use this reply as the answer' });
  await expect(useReply).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-message-by="demiurgo"]')).toHaveCount(1);
  await shot(page, '12-go-deeper-talk');
  await useReply.click();
  const own = panel.getByLabel('Your answer');
  await expect(own).toBeFocused();
  await expect(own).toHaveValue(/Got it/);
  await panel.getByRole('button', { name: 'Use as answer' }).click();
  await expect(panel).toHaveCount(0);
  await expect(question.getByRole('button', { name: /Go deeper · \d+ messages/ })).toBeFocused();
  await expect(question).toContainText('Your answer: Got it');

  // The other questions are answered elsewhere; Confirm and send then leaves nothing open, and
  // DEMIURGO reads the answers and goes on.
  for (let n = 0; n < 6; n++) {
    const open = (await detailOf(person, projectId, id)).questions.filter((q) => q.state === 'pending' && q.id !== asked.id);
    if (open.length === 0) break;
    for (const q of open) await person.command(projectId, 'question.confirm', { conclusion: 'Settled elsewhere.' }, q.id);
  }
  const bar = page.locator('[data-drafts-bar]');
  await expect(bar).toContainText('1 of 1 answer ready.');
  await bar.getByRole('button', { name: 'Confirm and send' }).click();
  await expect(statusOf(page, asked.id)).toHaveAttribute('data-status', 'confirmed');
  await expect(page.locator('[data-message-by="demiurgo"]')).toHaveCount(2, { timeout: 30_000 });
});

test('AC-INT-001-09 a design stage in its thread: its progress, the reserve of questions, two answers sent together and Pass stage once every one is answered', async ({
  page,
  person,
}) => {
  test.setTimeout(120_000);
  const projectId = await person.createProject('Stages');
  // The first root thread a person opens is the product's main thread: the design stages start there,
  // and DEMIURGO's first reply shows two of their questions (the rest wait in its reserve).
  const id = await openThread(person, projectId, 'Design the product');
  await person.command(projectId, 'message.post', {
    exploration_id: id,
    text: 'A tool to plan community events.',
    respond: true,
  });
  await runsSettled(person, projectId, id);
  await page.goto(`/p/${projectId}/threads/${id}`);

  const stage = page.locator('[data-thread-stage="requirements"]');
  await expect(stage).toContainText('Product definition');
  await expect(stage).toContainText('0 of 5 answered');
  await expect(page.locator('[data-reserve]')).toContainText('DEMIURGO keeps 3 questions for later.');
  const shown = (await detailOf(person, projectId, id)).questions.filter((q) => q.shown_at);
  expect(shown).toHaveLength(2);
  await expect(card(page, shown[0]?.id ?? '')).toContainText('Question · Product definition');

  // One answered with an option, the other in the person's words; both sent together.
  await card(page, shown[0]?.id ?? '')
    .getByRole('radio', { name: /Yes/ })
    .check();
  const message = page.getByLabel('Message');
  await card(page, shown[1]?.id ?? '')
    .getByRole('button', { name: 'Answer in my own words' })
    .click();
  await message.fill('Neighbours who organise events, and the people who come.');
  await message.press('Enter');
  const bar = page.locator('[data-drafts-bar]');
  await expect(bar).toContainText('2 of 2 answers ready.');
  await bar.getByRole('button', { name: 'Confirm and send' }).click();
  await expect(stage).toContainText('2 of 5 answered');
  await expect(page.locator('[data-reserve]')).toContainText('DEMIURGO keeps 1 question for later.');

  // The rest is answered elsewhere; once every question is covered the stage can be passed here.
  for (let n = 0; n < 5; n++) {
    const open = (await detailOf(person, projectId, id)).questions.filter((q) => q.state === 'pending');
    if (open.length === 0) break;
    for (const q of open) await person.command(projectId, 'question.confirm', { conclusion: 'Settled elsewhere.' }, q.id);
  }
  const complete = page.locator('[data-stage-complete="requirements"]');
  await expect(complete).toContainText('Product definition is complete: 5 of 5 answered.');
  await expect(complete).toContainText('next comes Global quality');
  await expectAccessible(page, 'a stage complete');
  await complete.scrollIntoViewIfNeeded();
  await shot(page, '13-stage-complete');
  await complete.getByRole('button', { name: 'Pass stage' }).click();
  const pass = page.getByRole('alertdialog', { name: 'Pass Product definition?' });
  await pass.getByRole('button', { name: 'Pass stage' }).click();
  await expect(page.locator('[data-thread-stage="quality"]')).toContainText('Global quality');
  await expect(page.locator('[data-thread-stage="quality"]')).toContainText('0 of 5 answered');
});

test('screens of cut 3: threads, a thread with its questions, the working run, the failure and a draft ready', async ({
  page,
  person,
}) => {
  test.setTimeout(180_000);
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
  await openThread(person, projectId, 'Signature of the evidence', { parent_id: main });
  const aside = await openThread(person, projectId, 'Import the v1 backlog');
  await person.command(projectId, 'exploration.set_aside', { reason: 'The v1 is only a reference.' }, aside);
  const done = await openThread(person, projectId, 'Name of the product');
  await person.command(projectId, 'exploration.conclude', { reason: 'It stays DEMIURGO.' }, done);

  await page.goto(`/p/${projectId}/threads`);
  await expect(page.locator('[data-thread-row]')).toHaveCount(4);
  await screenshot(page, 3, '01-threads');
  await shot(page, '01-threads');

  await page.goto(`/p/${projectId}/threads/${main}`);
  await expect(page.locator('[data-observation]').first()).toBeVisible();
  await screenshot(page, 3, '02-thread');
  await shot(page, '02-thread');
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
  await shot(page, '02b-thread-end');
  const first = (await detailOf(person, projectId, main)).questions.find((q) => q.state === 'pending' && q.shown_at);
  if (first) {
    await card(page, first.id)
      .getByRole('button', { name: /Go deeper/ })
      .click();
    await expect(page.getByRole('complementary', { name: 'Go deeper' })).toBeVisible();
    await shot(page, '07-go-deeper');
    await page.keyboard.press('Escape');
  }

  await page.goto(`/p/${projectId}/threads/${done}`);
  await expect(page.locator('[data-thread-conclusion]')).toBeVisible();
  await screenshot(page, 3, '06-thread-concluded');
  await shot(page, '06-thread-concluded');

  // The working card while DEMIURGO works; Cancel asks first and says what is kept.
  const slow = await openThread(person, projectId, 'Explore the runner reports');
  await page.goto(`/p/${projectId}/threads/${slow}`);
  await page.getByLabel('Message').fill('[slow] Look at every report of the runner before answering.');
  await page.getByRole('button', { name: 'Ask DEMIURGO' }).click();
  const working = page.locator('[data-run-card="working"]');
  await expect(working).toBeVisible({ timeout: 30_000 });
  await expect(working.locator('[data-run-timer]')).toHaveText(/^\d+:\d\d$/);
  await page.waitForTimeout(2200);
  await screenshot(page, 3, '03-run-working');
  await shot(page, '03-run-working');
  await working.getByRole('button', { name: 'Cancel' }).click();
  const cancel = page.getByRole('alertdialog', { name: 'Cancel this run?' });
  await expect(cancel).toContainText('what it already wrote in the thread stays');
  await cancel.getByRole('button', { name: 'Cancel the run' }).click();
  await expect(page.locator('[data-run-card="cancelled"]')).toBeVisible();

  // The failure, with the agent's own words and both ways to retry.
  const failing = await openThread(person, projectId, 'Explore the evidence format');
  await page.goto(`/p/${projectId}/threads/${failing}`);
  await page.getByLabel('Message').fill('[fail-once] Which fields does every piece of evidence carry?');
  await page.getByRole('button', { name: 'Ask DEMIURGO' }).click();
  const failed = page.locator('[data-run-card="failed"]');
  await expect(failed).toBeVisible({ timeout: 30_000 });
  await expect(failed.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(failed.getByRole('button', { name: 'Retry with…' })).toBeVisible();
  await expect(failed.getByRole('link', { name: 'Details of the conversation run' })).toBeVisible();
  await screenshot(page, 3, '04-run-failed');
  await shot(page, '04-run-failed');
  await expectAccessible(page, 'a thread with a failed run');

  // Under 1024 px: one column, the side panel's content in a sheet; under 768 px the list folds.
  // (The old stylesheet still holds every page at 1280 px until the last screen moves, D-017.)
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'html, body { min-width: 0 !important; }';
      document.head.append(style);
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/p/${projectId}/threads/${main}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await shot(page, '08-thread-390');
  await page.getByRole('button', { name: /Questions and threads/ }).click();
  const sheet = page.getByRole('dialog', { name: 'In this thread' });
  await expect(sheet.getByRole('heading', { name: 'Questions in this thread' })).toBeVisible();
  await shot(page, '09-thread-390-sheet');
  await expectAccessible(page, 'the thread at 390 px with its sheet');
  await page.keyboard.press('Escape');
  if (first) {
    const deeper = card(page, first.id).getByRole('button', { name: /Go deeper/ });
    await deeper.click();
    const deeperSheet = page.getByRole('dialog', { name: 'Go deeper' });
    await expect(deeperSheet.getByRole('heading', { level: 2, name: first.question })).toBeFocused();
    await shot(page, '17-go-deeper-390');
    await expectAccessible(page, 'Go deeper at 390 px');
    await page.keyboard.press('Escape');
    await expect(deeperSheet).toHaveCount(0);
    await expect(deeper).toBeFocused();
  }
  await page.goto(`/p/${projectId}/threads`);
  await expect(page.locator('[data-thread-row]')).toHaveCount(6);
  await shot(page, '10-threads-390');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1440, height: 900 });

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
  await shot(page, '05-draft-ready');
});
