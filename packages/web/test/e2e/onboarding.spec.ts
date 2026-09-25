// Day 1 (canvas step 4, adapted to H1; DESIGN.md §3.9): a new product from a blank page. The idea
// becomes a project and its first thread, DEMIURGO reads it live, the person answers its questions
// in the thread (the one-question walk stays reachable by URL, D-007) and asks it to propose
// decisions, and the day ends with what waits and "You can close DEMIURGO". What H1 cannot give yet
// (who uses it, rules, features) is a quiet "Later". Every state shows its word (data-status).
// The first thread of a project carries the design stages (v2.1): DEMIURGO's first reading shows
// two of their mandatory questions, and answering one can bring the next; the tests count what the
// API shows instead of a fixed number, or start the day in a second thread when they need only the
// questions they raise.

import type { Locator, Page } from '@playwright/test';
import { type PersonApi, expect, expectAccessible, screenshot, test } from './support/fixtures.ts';

type Detail = {
  purpose: string;
  messages: { author: string; kind: string | null; body: string; run_id: string | null; response: string | null }[];
  questions: {
    id: string;
    state: string;
    question: string;
    conclusion: string | null;
    state_reason: string | null;
    shown_at: string | null;
  }[];
};
type Run = { id: string; state: string; action: string; batch_id: string | null; retry_of: string | null };
type Batch = { id: string; state: string; proposals: { id: string; type: string; state: string }[] };

const IDEA =
  "We want an app to publish our association's activities and let members sign up. Organizers post trips, workshops and meetings, and they need to know who is coming.";
const STUDIO =
  'We run a small yoga studio and people should be able to book a place in a class online. Teachers publish their weekly classes, and we need to see who booked and close a class when it is full.';
const START_URL = /\/p\/([0-9a-f-]{36})\/start\/([0-9a-f-]{36})$/;

/**
 * Day 1 started through the API: the project, its thread and the idea, answered by DEMIURGO.
 * `stages: false` opens the product's main thread first, which takes the design stages and their
 * questions (they stay in its reserve), so the day walks only the questions a test raises.
 */
async function startDay(person: PersonApi, name: string, idea: string, { purpose = idea, stages = true } = {}) {
  const projectId = await person.createProject(name);
  if (!stages) await person.command(projectId, 'exploration.open', { purpose: 'The product' });
  const explorationId = (await person.command(projectId, 'exploration.open', { purpose })).entity_id;
  await person.command(projectId, 'message.post', { exploration_id: explorationId, text: idea, respond: true });
  return { projectId, explorationId };
}

/** Waits until the thread has `count` runs and none is working (the durable engine works in the background). */
function runsSettled(person: PersonApi, projectId: string, explorationId: string, count = 1) {
  return person.until<Run[]>(
    `/api/projects/${projectId}/runs?exploration=${explorationId}`,
    (runs) => runs.length >= count && runs.every((r) => !['queued', 'running'].includes(r.state)),
    45_000,
  );
}

const detailOf = (person: PersonApi, projectId: string, explorationId: string) =>
  person.get<Detail>(`/api/projects/${projectId}/explorations/${explorationId}`);

/** The questions the day shows: open, and out of DEMIURGO's reserve. */
const shownOpen = (detail: Detail) => detail.questions.filter((q) => q.shown_at && ['pending', 'inferred'].includes(q.state));

const willAsk = (n: number) => `Then I'll ask you ${n} ${n === 1 ? 'question' : 'questions'}, one at a time`;

/**
 * Walks the one-question screen to its end: the first `answer` questions get an answer (the first
 * option, or the person's own words), the rest are skipped.
 */
async function walk(page: Page, { answer, words }: { answer: number; words: string }) {
  for (let i = 0; i < 12; i++) {
    const aside = page.getByRole('complementary', { name: /^Question \d+ of \d+$/ });
    if ((await aside.count()) === 0) return;
    const title = (await aside.getByRole('heading', { level: 2 }).textContent()) ?? '';
    if (i < answer) {
      const option = aside.getByRole('radio').first();
      if ((await option.count()) > 0) await option.check();
      else await aside.getByLabel('Your answer').fill(words);
      await aside.getByRole('button', { name: 'Answer', exact: true }).click();
    } else {
      await aside.getByRole('button', { name: /^(Skip|Next)$/ }).click();
    }
    await expect(page.getByRole('heading', { level: 2, name: title, exact: true })).toHaveCount(0);
  }
}

const idsOf = (url: string) => {
  const [, projectId = '', explorationId = ''] = START_URL.exec(new URL(url).pathname) ?? [];
  return { projectId, explorationId };
};

/** Tab until the element has the focus, as a person with only a keyboard would. */
async function tabTo(page: Page, target: Locator, max = 60) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached ${target.toString()}`);
}

test('AC-INT-001-01 a new product from a blank page: the idea becomes a project and its first thread, DEMIURGO reads it live, and its first reading is all Proposed', async ({
  page,
  person,
}) => {
  test.setTimeout(120_000);
  await page.goto('/new');
  await expect(page.getByRole('heading', { level: 1, name: 'What do you want to build?' })).toBeVisible();
  await expect(page.getByText('Nothing is decided until you confirm it')).toBeVisible();
  await expect(page.getByText('You can change anything later')).toBeVisible();
  await expect(page.getByText('Everything stays here, saved')).toBeVisible();
  await expect(page.getByText('You can rename it later.')).toBeVisible();
  await expectAccessible(page, 'what do you want to build');

  // An example fills the idea and a name for the project.
  await page.getByRole('button', { name: 'Activities for my association' }).click();
  await expect(page.getByLabel('Describe your idea')).toHaveValue(IDEA);
  await expect(page.getByLabel('Name')).toHaveValue('Club Activities');
  await page.getByRole('button', { name: 'Start' }).click();

  // The idea becomes a project and its first thread, with the idea as the person wrote it.
  await expect(page).toHaveURL(START_URL);
  const { projectId, explorationId } = idsOf(page.url());
  const projects = await person.get<{ id: string; name: string }[]>('/api/projects');
  expect(projects.find((p) => p.id === projectId)?.name).toBe('Club Activities');
  const opened = await detailOf(person, projectId, explorationId);
  expect(opened.purpose).toBe(IDEA);
  expect(opened.messages[0]).toMatchObject({ author: 'human:ana', body: IDEA });

  // DEMIURGO reads it live: its reading arrives through the stream, all proposed or unknown.
  const reading = page.getByRole('region', { name: 'DEMIURGO reads your idea' });
  await expect(reading).toContainText(IDEA);
  await expect(reading.getByRole('heading', { name: "Here's a first reading of your idea" })).toBeVisible({ timeout: 45_000 });
  const read = await detailOf(person, projectId, explorationId);
  const observed = read.messages.filter((m) => m.kind);
  expect(observed.length).toBeGreaterThan(0);
  await expect(reading.locator('[data-observation]')).toHaveCount(observed.length);
  await expect(reading.locator('[data-observation="hypothesis"] [data-status]').first()).toHaveAttribute(
    'data-status',
    'proposed',
  );
  const shown = shownOpen(read);
  expect(shown.length).toBeGreaterThan(0);
  await expect(reading.locator('[data-reading-question]')).toHaveCount(shown.length);
  await expect(reading.locator('[data-reading-question] [data-status]').first()).toHaveAttribute('data-status', 'open');
  await expect(page.locator('main [data-status="confirmed"]')).toHaveCount(0);
  await expectAccessible(page, 'DEMIURGO reading the idea');

  // Here's what I understood: everything proposed, its questions, and what comes later. The button
  // that swapped the view is gone, so the focus goes to the new title.
  await reading.getByRole('button', { name: 'See what I understood' }).click();
  await expect(page.getByText('This is my first reading of your idea.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Club Activities' })).toBeFocused();
  const understood = page.getByRole('region', { name: 'What I understood' });
  await expect(understood.locator('[data-observation]')).toHaveCount(observed.length);
  for (const mark of await understood.locator('[data-observation] [data-status]').all()) {
    expect(['proposed', 'unknown']).toContain(await mark.getAttribute('data-status'));
  }
  await expect(page.getByRole('heading', { name: willAsk(shown.length) })).toBeVisible();
  // One primary action: the questions are answered in the thread.
  await expect(page.getByRole('link', { name: 'Answer in the thread' })).toHaveAttribute(
    'href',
    `/p/${projectId}/threads/${explorationId}`,
  );
  await expect(page.locator('[data-later]')).toHaveCount(3);
  await expect(page.locator('[data-later="who"]')).toContainText('Later');
  await expect(page.locator('main [data-status="confirmed"]')).toHaveCount(0);
  await expectAccessible(page, "here's what I understood");

  // Correct something: DEMIURGO reads it again, with the correction.
  await page.getByRole('button', { name: 'Correct something' }).click();
  const correction = page.getByLabel("What's wrong?");
  await expect(correction).toBeFocused();
  await correction.fill('Visitors can see the activities too, only members sign up.');
  await page.getByRole('button', { name: 'Send and read again' }).click();
  await expect(page.getByText('This is my new reading, with your corrections.')).toBeVisible({ timeout: 45_000 });
  await expect(understood).toContainText('Visitors can see the activities too');
  const corrected = await detailOf(person, projectId, explorationId);
  expect(corrected.messages.filter((m) => m.author === 'human:ana').map((m) => m.body)).toEqual([
    IDEA,
    'Visitors can see the activities too, only members sign up.',
  ]);
  expect(corrected.messages.filter((m) => m.author.startsWith('agent:run:') && !m.kind)).toHaveLength(2);
});

test('AC-INT-001-09 Day 1 asks its questions one at a time and each answer confirms the question', async ({ page, person }) => {
  test.setTimeout(120_000);
  const { projectId, explorationId } = await startDay(person, 'Studio Bookings', STUDIO, { stages: false });
  await runsSettled(person, projectId, explorationId);
  // Three questions, so the day walks three.
  const raise = async (question: string, extra: Record<string, unknown> = {}) =>
    (await person.command(projectId, 'question.raise', { exploration_id: explorationId, question, ...extra })).entity_id;
  const first = await raise('Who books the classes?', { reason: 'Defines the scope of the first design.', impact: 'high' });
  const second = await raise('Can a person book more than one class a week?', {
    reason: 'It decides whether the studio needs limits per person.',
    impact: 'medium',
  });
  const third = await raise('Do teachers get paid through the app?');
  const asked = shownOpen(await detailOf(person, projectId, explorationId));
  expect(asked.map((q) => q.id)).toEqual([first, second, third]);

  await page.goto(`/p/${projectId}/start/${explorationId}`);
  await expect(page.getByRole('heading', { name: willAsk(3) })).toBeVisible();
  // Since patch 4af77f1 the questions are answered in the thread; the one-question walk is reached
  // by its URL only (D-007).
  await expect(page.getByRole('link', { name: 'Answer in the thread' })).toHaveAttribute(
    'href',
    `/p/${projectId}/threads/${explorationId}`,
  );
  await expect(page.getByRole('link', { name: 'Answer the questions' })).toHaveCount(0);
  await page.goto(`/p/${projectId}/start/${explorationId}/questions`);

  // 1 of 3: the question in big type, why it matters and what it affects; Answer confirms it.
  const one = page.getByRole('complementary', { name: 'Question 1 of 3' });
  await expect(one.getByRole('heading', { level: 2, name: 'Who books the classes?' })).toBeVisible();
  await expect(one.getByRole('heading', { level: 2, name: 'Who books the classes?' })).toBeFocused();
  await expect(one).toContainText('Why it matters');
  await expect(one).toContainText('Defines the scope of the first design.');
  await expect(one).toContainText('It shapes a lot of the design.');
  await expect(one.locator('[data-status]').first()).toHaveAttribute('data-status', 'open');
  await expectAccessible(page, 'a question of Day 1');
  await expect(one.getByRole('button', { name: 'Answer', exact: true })).toBeDisabled();
  await one.getByLabel('Your answer').fill('People who book a class, and the teachers who publish them.');
  await one.getByRole('button', { name: 'Answer', exact: true }).click();

  // 2 of 3: Skip leaves it open.
  const two = page.getByRole('complementary', { name: 'Question 2 of 3' });
  await expect(two.getByRole('heading', { level: 2, name: 'Can a person book more than one class a week?' })).toBeVisible();
  await expect(two).toContainText('It decides whether the studio needs limits per person.');
  await expect(two).toContainText('It shapes part of the design.');
  // The answer given is in the main column, confirmed.
  const answers = page.getByRole('region', { name: 'Your answers' });
  await expect(answers).toContainText('People who book a class, and the teachers who publish them.');
  await expect(answers.locator('[data-status]').first()).toHaveAttribute('data-status', 'confirmed');
  await two.getByRole('button', { name: 'Skip' }).click();

  // 3 of 3: Park keeps it for later, with a reason (one vocabulary: DESIGN.md §4.4).
  const three = page.getByRole('complementary', { name: 'Question 3 of 3' });
  await expect(three.getByRole('heading', { level: 2, name: 'Do teachers get paid through the app?' })).toBeVisible();
  await three.getByRole('button', { name: 'Park', exact: true }).click();
  const park = page.getByRole('dialog', { name: 'Park this question' });
  await park.getByLabel('Reason').fill('Payments come later.');
  await park.getByRole('button', { name: 'Park', exact: true }).click();

  // The end: what happened to each question, and the way to ask for decisions.
  const end = page.getByRole('complementary', { name: 'Questions done' });
  await expect(end.getByRole('heading', { name: "That's all my questions for now" })).toBeVisible();
  await expect(end).toContainText('You answered 1, skipped 1 and parked 1.');
  await expect(end.getByRole('button', { name: 'Ask DEMIURGO to propose decisions' })).toBeEnabled();
  await expectAccessible(page, 'the end of the questions');

  const after = await detailOf(person, projectId, explorationId);
  const stateOf = (id: string | undefined) => after.questions.find((q) => q.id === id);
  expect(stateOf(first)).toMatchObject({
    state: 'confirmed',
    conclusion: 'People who book a class, and the teachers who publish them.',
  });
  expect(stateOf(second)?.state).toBe('pending');
  expect(stateOf(third)).toMatchObject({ state: 'postponed', state_reason: 'Payments come later.' });
});

test('AC-INT-001-01 after the questions DEMIURGO proposes a decision and the day ends with what waits for the person and "You can close DEMIURGO"', async ({
  page,
  person,
}) => {
  test.setTimeout(150_000);
  const { projectId, explorationId } = await startDay(person, 'Club Activities', IDEA, { stages: false });
  await runsSettled(person, projectId, explorationId);
  await person.command(projectId, 'question.raise', { exploration_id: explorationId, question: 'Who can sign up?' });

  await page.goto(`/p/${projectId}/start/${explorationId}/questions`);
  const one = page.getByRole('complementary', { name: 'Question 1 of 1' });
  await one.getByLabel('Your answer').fill('Only members of the association sign up; organizers publish.');
  await one.getByRole('button', { name: 'Answer', exact: true }).click();

  // After the last one: DEMIURGO is asked to propose decisions from the answers.
  const end = page.getByRole('complementary', { name: 'Questions done' });
  await end.getByRole('button', { name: 'Ask DEMIURGO to propose decisions' }).click();
  await expect(end.getByText('DEMIURGO proposed 1 decision.')).toBeVisible({ timeout: 45_000 });
  const asked = await detailOf(person, projectId, explorationId);
  const request = asked.messages.filter((m) => m.author === 'human:ana').at(-1);
  expect(request?.body.startsWith('I decide: Only members of the association sign up; organizers publish.')).toBe(true);
  await end.getByRole('link', { name: 'See your starting point' }).click();

  // The day ends with what it produced, what waits for the person and "You can close DEMIURGO".
  await expect(page).toHaveURL(new RegExp(`/start/${explorationId}/done$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Your starting point is ready' })).toBeVisible();
  const numbers = page.locator('[data-day-numbers]');
  await expect(numbers).toContainText('1idea');
  await expect(numbers).toContainText('1question answered');
  await expect(numbers).toContainText('1decision proposed');
  await expect(page.getByText(/^Today · \d+ minutes?$/)).toBeVisible();
  const waiting = page.getByRole('complementary', { name: 'What happens now' });
  await expect(waiting.locator('[data-count]').first()).toHaveAttribute('data-count', '1');
  await expect(waiting.locator('[data-waiting-decision]')).toHaveCount(1);
  await expect(waiting).toContainText('You can close DEMIURGO');
  await expect(waiting).toContainText("Everything is saved. When you come back, I'll show you what changed while you were away.");
  await expect(page.getByRole('link', { name: 'Go to the product' })).toHaveAttribute('href', `/p/${projectId}`);
  await expectAccessible(page, 'your starting point');

  // Review the decisions: accepting it (and approving it) happens on its batch page.
  await page.getByRole('link', { name: 'Review the decisions' }).click();
  await expect(page).toHaveURL(/\/batches\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Accept and approve' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Accept and approve' }).click();
  await expect(page.getByText('Accepted', { exact: true }).first()).toBeVisible();
  const runs = await person.get<Run[]>(`/api/projects/${projectId}/runs?exploration=${explorationId}`);
  const batchId = runs.find((r) => r.batch_id)?.batch_id ?? '';
  const batch = await person.get<Batch>(`/api/projects/${projectId}/batches/${batchId}`);
  expect(batch.proposals.map((p) => [p.type, p.state])).toEqual([['decision', 'accepted']]);
  await person.until<{ up_to_date: boolean; updates_in_progress: number }>(
    `/api/projects/${projectId}/knowledge`,
    (k) => k.up_to_date && k.updates_in_progress === 0,
  );

  // Back on the day: nothing of it waits, and what's next is drafting the decision in the thread.
  await page.goto(`/p/${projectId}/start/${explorationId}/done`);
  await expect(page.locator('[data-waiting-decision]')).toHaveCount(0);
  const next = page.locator('[data-whats-next]');
  await expect(next).toContainText('Draft it');
  await next.getByRole('link', { name: 'Open the thread' }).click();
  await expect(page).toHaveURL(new RegExp(`/threads/${explorationId}$`));
  await expect(page.getByRole('button', { name: 'Draft it' })).toBeEnabled();
  await page.getByRole('button', { name: 'Draft it' }).click();
  await expect(page.getByRole('menuitem').first()).toContainText('From this thread');
});

test('AC-INT-001-10 Day 1 shows the rust card when DEMIURGO cannot read the idea, and Retry reads it again', async ({
  page,
  person,
}) => {
  test.setTimeout(120_000);
  await page.goto('/new');
  await page
    .getByLabel('Describe your idea')
    .fill('[fail-once] A shared shopping list for our flat, where anyone adds what is missing.');
  await page.getByLabel('Name').fill('Flat List');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(START_URL);
  const { projectId, explorationId } = idsOf(page.url());

  const failed = page.locator('[data-reading="failed"]');
  await expect(failed).toBeVisible({ timeout: 45_000 });
  await expect(failed).toContainText("I couldn't finish reading your idea");
  await expect(failed).toContainText('The agent answered with an error. Nothing was changed.');
  await expect(failed.locator('[data-status="problem"]')).toHaveCount(1);
  await expectAccessible(page, 'Day 1 when the reading failed');

  await failed.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: "Here's a first reading of your idea" })).toBeVisible({ timeout: 45_000 });
  const runs = await person.get<Run[]>(`/api/projects/${projectId}/runs?exploration=${explorationId}`);
  expect(runs.map((r) => r.state).sort()).toEqual(['completed', 'failed']);
  expect(runs.find((r) => r.state === 'completed')?.retry_of).toBe(runs.find((r) => r.state === 'failed')?.id);
});

test('a correction sent while knowledge catches up says so, is answered once, and never offers to ask again', async ({
  page,
  person,
}) => {
  test.setTimeout(150_000);
  const { projectId, explorationId } = await startDay(person, 'Catching Up', IDEA);
  await runsSettled(person, projectId, explorationId);
  // A taxonomy makes the classifier run, and the marker makes each of its calls take 8 s: the
  // approval below keeps knowledge busy while the correction is sent.
  const taxonomy = await person.command(projectId, 'taxonomy.propose', {
    code: 'TAX-001',
    title: 'Areas',
    axes: [
      {
        code: 'area',
        name: 'Area',
        categories: [
          { code: 'design', name: 'Design', description: 'Decisions and features.' },
          { code: 'other', name: 'Other', description: 'Nothing else fits.' },
        ],
      },
    ],
  });
  await person.command(projectId, 'taxonomy.approve', {}, taxonomy.entity_id);

  await page.goto(`/p/${projectId}/start/${explorationId}`);
  await page.getByRole('button', { name: 'Correct something' }).click();
  await page.getByLabel("What's wrong?").fill('Visitors can see the activities too, only members sign up.');
  const created = await person.command<{ versionId: string }>(projectId, 'record.create', {
    type: 'decision',
    domain: 'club',
    title: 'Sign-ups are instant [slow-knowledge]',
    sections: [
      { title: 'Context', content: 'Members sign up for activities.' },
      { title: 'Decision', content: 'Signing up needs no approval.' },
      { title: 'Consequences', content: 'Organizers see sign-ups at once.' },
    ],
  });
  await person.command(projectId, 'record_version.approve', {}, created.result?.versionId);
  await page.getByRole('button', { name: 'Send and read again' }).click();

  await expect(page.getByText('DEMIURGO is catching up on what you just decided…')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Ask DEMIURGO' })).toHaveCount(0);
  await expect(page.getByText('This is my new reading, with your corrections.')).toBeVisible({ timeout: 90_000 });
  const runs = await person.get<Run[]>(`/api/projects/${projectId}/runs?exploration=${explorationId}`);
  expect(runs.filter((r) => r.action === 'exploration_chat')).toHaveLength(2);
  const detail = await detailOf(person, projectId, explorationId);
  const correction = detail.messages.find((m) => m.body.startsWith('Visitors can see'));
  expect(correction).toMatchObject({ response: 'requested' });
});

test('AC-INT-001-02 with no projects DEMIURGO opens on "What do you want to build?", and New project is at hand on the projects page and in the header', async ({
  page,
  person,
}) => {
  // The shared test server has projects from other tests: this one sees an empty list.
  await page.route('**/api/projects', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: [] }) : route.fallback(),
  );
  await page.goto('/');
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.getByRole('heading', { level: 1, name: 'What do you want to build?' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Your projects' })).toHaveCount(0);
  await page.unroute('**/api/projects');

  const projectId = await person.createProject('Entry points');
  await page.goto('/projects');
  await page.getByRole('main').getByRole('link', { name: 'New project' }).click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.getByRole('link', { name: 'Your projects' })).toBeVisible();

  // Inside a project, New project is in the project switcher.
  await page.goto(`/p/${projectId}`);
  await page.getByRole('button', { name: /^Project: Entry points/ }).click();
  await page.getByRole('menuitem', { name: 'New project' }).click();
  await expect(page).toHaveURL(/\/new$/);
});

test('AC-WEB-001-03 the onboarding works with the keyboard only', async ({ page, person }) => {
  test.setTimeout(180_000);
  await page.goto('/new');
  await tabTo(page, page.getByLabel('Describe your idea'));
  await page.keyboard.type('A notebook for my bike rides, with the route, the distance and how I felt.');
  await tabTo(page, page.getByLabel('Name'));
  await page.keyboard.type('Ride Notes');
  await tabTo(page, page.getByRole('button', { name: 'Start' }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(START_URL, { timeout: 30_000 });
  const { projectId, explorationId } = idsOf(page.url());

  const understood = page.getByRole('button', { name: 'See what I understood' });
  await expect(understood).toBeVisible({ timeout: 45_000 });
  await tabTo(page, understood);
  await page.keyboard.press('Enter');
  // The focus is not lost when the view swaps: it is on the new title, and the next Tab stops go on.
  await expect(page.getByRole('heading', { level: 1, name: 'Ride Notes' })).toBeFocused();
  const answer = page.getByRole('link', { name: 'Answer in the thread' });
  await tabTo(page, answer);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/threads/${explorationId}$`));

  // The one-question walk, by its URL (D-007).
  await page.goto(`/p/${projectId}/start/${explorationId}/questions`);

  // Each question by keyboard: the first answer (a radio, picked with Space) or the person's own words.
  await expect(page.getByRole('complementary', { name: /^Question 1 of \d+$/ })).toBeVisible();
  const walked: string[] = [];
  for (let i = 0; i < 12; i++) {
    const aside = page.getByRole('complementary', { name: /^Question \d+ of \d+$/ });
    if ((await aside.count()) === 0) break;
    const title = (await aside.getByRole('heading', { level: 2 }).textContent()) ?? '';
    walked.push(title);
    const option = aside.getByRole('radio').first();
    if ((await option.count()) > 0) {
      await tabTo(page, option);
      await page.keyboard.press('Space');
    } else {
      await tabTo(page, aside.getByLabel('Your answer'));
      await page.keyboard.type('Only me, after each ride.');
    }
    await tabTo(page, aside.getByRole('button', { name: 'Answer', exact: true }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 2, name: title, exact: true })).toHaveCount(0);
  }
  expect(walked.length).toBeGreaterThan(0);

  const end = page.getByRole('complementary', { name: 'Questions done' });
  await tabTo(page, end.getByRole('button', { name: 'Ask DEMIURGO to propose decisions' }));
  await page.keyboard.press('Enter');
  const see = end.getByRole('link', { name: 'See your starting point' });
  await expect(end.getByText('DEMIURGO proposed 1 decision.')).toBeVisible({ timeout: 45_000 });
  await tabTo(page, see);
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { level: 1, name: 'Your starting point is ready' })).toBeVisible();
  await expectAccessible(page, 'your starting point, by keyboard');
  await tabTo(page, page.getByRole('link', { name: 'Review the decisions' }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/batches\/[0-9a-f-]{36}$/);
  await tabTo(page, page.getByRole('button', { name: 'Accept and approve' }));
  await page.keyboard.press('Enter');
  const confirm = page.getByRole('alertdialog').getByRole('button', { name: 'Accept and approve' });
  await tabTo(page, confirm);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Accepted', { exact: true }).first()).toBeVisible();
  const detail = await detailOf(person, projectId, explorationId);
  for (const title of walked) expect(detail.questions.find((q) => q.question === title)?.state).toBe('confirmed');
});

test('screens of the onboarding: what do you want to build, DEMIURGO reading live, its first reading, what it understood, correcting it, one question, the end of the questions, the starting point and a failed reading', async ({
  page,
  person,
}) => {
  test.setTimeout(200_000);

  // 1 · What do you want to build?
  await page.goto('/new');
  await page.getByRole('button', { name: 'Activities for my association' }).click();
  await screenshot(page, 8, '01-what-do-you-want-to-build');

  // 2 · DEMIURGO reads it live: the amber card while it works (a slow run, cancelled afterwards).
  const slow = await startDay(person, 'Club Activities', IDEA, { purpose: `${IDEA} [slow]` });
  await page.goto(`/p/${slow.projectId}/start/${slow.explorationId}`);
  const working = page.locator('[data-reading="working"]');
  await expect(working).toBeVisible({ timeout: 45_000 });
  await expect(working.getByRole('heading', { name: 'Reading your idea…' })).toBeVisible();
  await screenshot(page, 8, '02-reading-live');
  // Cancel asks first and says what is kept.
  await working.getByRole('button', { name: 'Cancel' }).click();
  const cancel = page.getByRole('alertdialog', { name: 'Cancel this run?' });
  await expect(cancel).toContainText('Nothing is applied');
  await cancel.getByRole('button', { name: 'Cancel the run' }).click();
  await expect(page.locator('[data-reading="cancelled"]')).toBeVisible({ timeout: 30_000 });

  // 3 · Its first reading, through the page that started it.
  await page.goto('/new');
  await page.getByRole('button', { name: 'Activities for my association' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(START_URL);
  const { projectId, explorationId } = idsOf(page.url());
  await expect(page.getByRole('heading', { name: "Here's a first reading of your idea" })).toBeVisible({ timeout: 45_000 });
  await screenshot(page, 8, '03-first-reading');

  // 4 · Here's what I understood (two more questions raised, so the day walks three).
  await page.getByRole('button', { name: 'See what I understood' }).click();
  await expect(page.getByText('This is my first reading of your idea.')).toBeVisible();
  for (const question of ['Can anyone sign up, or only members?', 'Is there a limit on places?']) {
    await person.command(projectId, 'question.raise', { exploration_id: explorationId, question, impact: 'medium' });
  }
  const shown = shownOpen(await detailOf(person, projectId, explorationId));
  await expect(page.getByRole('heading', { name: willAsk(shown.length) })).toBeVisible();
  await screenshot(page, 8, '04-what-i-understood');

  // 5 · Correct something: the person says what's wrong (not sent here).
  await page.getByRole('button', { name: 'Correct something' }).click();
  await page.getByLabel("What's wrong?").fill('Visitors can see the activities too; only members sign up.');
  await screenshot(page, 8, '05-correct-something');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  // 6 · One question at a time (by its URL, D-007): two answered, the rest skipped.
  await page.goto(`/p/${projectId}/start/${explorationId}/questions`);
  await expect(page.getByRole('complementary', { name: /^Question 1 of \d+$/ })).toBeVisible();
  await screenshot(page, 8, '06-one-question');
  await walk(page, { answer: 2, words: 'Organizers who publish activities and members who sign up.' });

  // 7 · The end of the questions, once DEMIURGO proposed its decisions.
  const end = page.getByRole('complementary', { name: 'Questions done' });
  await end.getByRole('button', { name: 'Ask DEMIURGO to propose decisions' }).click();
  await expect(end.getByText(/DEMIURGO proposed \d+ decisions?\./)).toBeVisible({ timeout: 45_000 });
  await screenshot(page, 8, '07-end-of-the-questions');

  // 8 · Your starting point.
  await end.getByRole('link', { name: 'See your starting point' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Your starting point is ready' })).toBeVisible();
  await screenshot(page, 8, '08-starting-point');

  // 9 · A reading that failed: the rust card with Retry.
  const failing = await startDay(person, 'Flat List', 'A shared shopping list for our flat.', {
    purpose: 'A shared shopping list for our flat. [fail-once]',
  });
  await page.goto(`/p/${failing.projectId}/start/${failing.explorationId}`);
  await expect(page.locator('[data-reading="failed"]')).toBeVisible({ timeout: 45_000 });
  await screenshot(page, 8, '09-reading-failed');
});
