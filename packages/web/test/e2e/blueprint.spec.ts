// The product blueprint (canvas B1 and B2, cut 8): the rail of a record page with the product's
// features and decisions, the sections of a record (Overview, Questions, Checks, History), the
// questions of its thread answered in place with "If you confirm", and the header search.

import type { Page } from '@playwright/test';
import type { ExplorationDetail } from '../../src/api/types.ts';
import { tabTo } from './needs-data.ts';
import { CHECKS, createDecision, createFeature, foldLegend, recordOf, settled } from './record-setup.ts';
import { BASE_URL, type PersonApi, expect, expectAccessible, screenshot, test } from './support/fixtures.ts';

const api = (projectId: string, path: string) => `/api/projects/${projectId}${path}`;

type Thread = { id: string; assumed: string; pay: string; twice: string };

/**
 * A thread where DEMIURGO asked who uses the product first and assumed the answer from what the
 * person said next, plus two questions of the person that are still open.
 */
async function threadWithAnswers(person: PersonApi, projectId: string, purpose: string): Promise<Thread> {
  const id = (await person.command(projectId, 'exploration.open', { purpose })).entity_id;
  await person.command(projectId, 'message.post', { exploration_id: id, text: 'Members sign up for activities.' });
  await person.until<ExplorationDetail>(api(projectId, `/explorations/${id}`), (x) =>
    x.questions.some((q) => q.state === 'pending'),
  );
  await person.command(projectId, 'message.post', {
    exploration_id: id,
    text: "Let's go with members and organizers first, then guests once the pilot is over.",
  });
  const x = await person.until<ExplorationDetail>(api(projectId, `/explorations/${id}`), (v) =>
    v.questions.some((q) => q.state === 'inferred'),
  );
  const assumed = x.questions.find((q) => q.state === 'inferred')?.id ?? '';
  const pay = await person.command(projectId, 'question.raise', {
    exploration_id: id,
    question: 'Do guests pay for an activity?',
    reason: 'It changes the sign-up form.',
    impact: 'medium',
  });
  const twice = await person.command(projectId, 'question.raise', { exploration_id: id, question: 'Can a guest come twice?' });
  return { id, assumed, pay: pay.entity_id, twice: twice.entity_id };
}

const sectionsOf = (page: Page) => page.getByRole('navigation', { name: 'Record sections' });
const railOf = (page: Page) => page.getByRole('navigation', { name: 'Blueprint' });
const searchOf = (page: Page) => page.getByRole('combobox', { name: 'Search decisions, features, ideas' });
const markOf = (page: Page, questionId: string) => page.locator(`[data-question="${questionId}"] [data-mark]`).first();

async function noHorizontalScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("AC-INT-001-09 on a feature the Questions tab answers the questions of its thread in place: confirm the recommended answer, not now and doesn't apply change each mark at once", async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Questions in place');
  const t = await threadWithAnswers(person, projectId, 'Sign-ups for club activities');
  const fdr = await createFeature(person, projectId, 'Sign up for an activity', { origin: { type: 'exploration', id: t.id } });

  await page.goto(`/p/${projectId}/records/${fdr.code}`);
  const sections = sectionsOf(page);
  await sections.getByRole('link', { name: 'Questions · 3' }).click();
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}/records/${fdr.code}?tab=questions`);
  await expect(sections.getByRole('link', { name: 'Questions · 3' })).toHaveAttribute('aria-current', 'page');
  await expect(sections.locator('[aria-current="page"]')).toHaveCount(1);
  // Approve stays in the header of every section.
  await expect(page.locator('[data-record-actions]').getByRole('button', { name: 'Approve', exact: true })).toBeVisible();

  // Open ones first: the person's two, then DEMIURGO's assumed answer, recommended with its why.
  const open = page.locator('[data-open-questions] > [data-question]');
  await expect(open).toHaveCount(3);
  await expect(open.nth(0)).toHaveAttribute('data-question', t.pay);
  await expect(open.nth(2)).toHaveAttribute('data-question', t.assumed);
  const pay = page.locator(`[data-question="${t.pay}"]`);
  await expect(pay.getByRole('heading', { name: 'Do guests pay for an activity?' })).toBeVisible();
  await expect(pay).toContainText('Why it matters: It changes the sign-up form.');
  await expect(pay).toContainText('Impact: Medium');
  await expect(markOf(page, t.pay)).toHaveAttribute('data-mark', 'open');
  const assumed = page.locator(`[data-question="${t.assumed}"]`);
  await expect(
    assumed.getByRole('heading', { name: 'Who will use the product first, and what do they need to do?' }),
  ).toBeVisible();
  await expect(assumed).toContainText('Why it matters: Defines the scope of the first design.');
  const recommended = assumed.locator('[data-recommended]');
  await expect(recommended).toContainText('Recommended');
  await expect(recommended).toContainText("Let's go with members and organizers first, then guests once the pilot is over.");
  await expect(recommended).toContainText('Why: The person expressed it in their last message.');
  await expect(markOf(page, t.assumed)).toHaveAttribute('data-mark', 'assumed');
  await expect(assumed.getByRole('link', { name: /Talk about it in the thread/ })).toHaveAttribute(
    'href',
    `/p/${projectId}/threads/${t.id}`,
  );

  // "If you confirm" follows the question in hand: the first open one, then the one chosen.
  const aside = page.getByRole('region', { name: 'If you confirm' });
  await expect(aside).toContainText('Do guests pay for an activity?');
  await expect(aside).toContainText('A question of its thread is open: “Do guests pay for an activity?”');
  await expect(aside.locator('[data-later]')).toContainText('Later');
  await expect(aside.locator('[data-later]')).toContainText('Becomes a decision and adds checks on its own');
  await expectAccessible(page, 'the Questions tab of a feature');
  await assumed.getByRole('heading').click();
  await expect(aside).toContainText('Who will use the product first');
  await expect(aside).toContainText("Let's go with members and organizers first");
  await expect(aside).toContainText('Yes. It waits until you confirm the answer DEMIURGO assumed.');
  for (const c of CHECKS) await expect(aside.locator('[data-aside-check]').filter({ hasText: c.title })).toHaveCount(1);
  await expect(aside).not.toContainText('Becomes a decision:');

  // Confirm the recommended answer: decisive, so it asks first.
  await assumed.getByRole('button', { name: "Confirm: Let's go with members and organizers first,…" }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Confirm this answer?' });
  await expect(confirm).toContainText("Let's go with members and organizers first");
  await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(sections.getByRole('link', { name: 'Questions · 2' })).toBeVisible();
  const answered = page.locator('details[data-group="answered"]');
  await expect(answered.locator('summary')).toHaveText('Answered · 1');
  await answered.locator('summary').click();
  await expect(markOf(page, t.assumed)).toHaveAttribute('data-mark', 'confirmed');
  await expect(answered.locator(`[data-question="${t.assumed}"]`)).toContainText("Let's go with members and organizers first");

  // Not now asks for a reason and parks it.
  await pay.getByRole('button', { name: 'Not now' }).click();
  const later = page.getByRole('dialog', { name: 'Leave it for later' });
  await later.getByLabel('Reason').fill('After the pilot.');
  await later.getByRole('button', { name: 'Leave it for later' }).click();
  await expect(later).toBeHidden();
  const notNow = page.locator('details[data-group="not-now"]');
  await expect(notNow.locator('summary')).toHaveText('Not now · 1');
  await notNow.locator('summary').click();
  await expect(markOf(page, t.pay)).toHaveAttribute('data-mark', 'parked');
  await expect(notNow.locator(`[data-question="${t.pay}"]`)).toContainText('After the pilot.');

  // Doesn't apply asks for a reason and drops it.
  await page.locator(`[data-question="${t.twice}"]`).getByRole('button', { name: "Doesn't apply" }).click();
  const drop = page.getByRole('dialog', { name: "Doesn't apply" });
  await drop.getByLabel('Reason').fill('A guest comes once, by definition.');
  await drop.getByRole('button', { name: "Doesn't apply" }).click();
  await expect(drop).toBeHidden();
  const dropped = page.locator('details[data-group="doesnt-apply"]');
  await expect(dropped.locator('summary')).toHaveText("Doesn't apply · 1");
  await dropped.locator('summary').click();
  await expect(markOf(page, t.twice)).toHaveAttribute('data-mark', 'dropped');

  // Nothing is open any more: the tab has no count and says so.
  await expect(sections.getByRole('link', { name: 'Questions', exact: true })).toBeVisible();
  await expect(page.getByText('Nothing to answer here: no question of its thread is open.')).toBeVisible();
  await expectAccessible(page, 'the Questions tab with every question settled');
  const detail = await person.get<ExplorationDetail>(api(projectId, `/explorations/${t.id}`));
  const stateOf = (id: string) => detail.questions.find((q) => q.id === id)?.state;
  expect([stateOf(t.assumed), stateOf(t.pay), stateOf(t.twice)]).toEqual(['confirmed', 'postponed', 'discarded']);
  expect(detail.questions.find((q) => q.id === t.assumed)?.conclusion).toBe(
    "Let's go with members and organizers first, then guests once the pilot is over.",
  );
});

test("AC-INT-001-09 an open question is answered in the Questions tab with the person's own words, and a version without a thread says it has none", async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Own answer');
  const t = await threadWithAnswers(person, projectId, 'Guest passes');
  const fdr = await createFeature(person, projectId, 'Guest passes', { origin: { type: 'exploration', id: t.id } });
  await page.goto(`/p/${projectId}/records/${fdr.code}?tab=questions`);
  const pay = page.locator(`[data-question="${t.pay}"]`);
  await pay.getByRole('button', { name: 'Answer' }).click();
  const answer = page.getByRole('dialog', { name: 'Answer the question' });
  await answer.getByLabel('Conclusion').fill('No: activities are free for guests.');
  await answer.getByRole('button', { name: 'Answer' }).click();
  await expect(answer).toBeHidden();
  await expect(sectionsOf(page).getByRole('link', { name: 'Questions · 2' })).toBeVisible();
  await expect(page.locator('details[data-group="answered"] summary')).toHaveText('Answered · 1');
  await expect(markOf(page, t.pay)).toHaveAttribute('data-mark', 'confirmed');

  const bare = await createFeature(person, projectId, 'Bring a friend');
  await page.goto(`/p/${projectId}/records/${bare.code}?tab=questions`);
  await expect(page.getByText("This version doesn't come from a thread, so it has no questions.")).toBeVisible();
  await expect(sectionsOf(page).getByRole('link', { name: 'Questions', exact: true })).toHaveAttribute('aria-current', 'page');
});

test("AC-INT-001-04 the blueprint rail lists the product's features and decisions with their state and marks, and highlights the one on screen", async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Club Activities');
  const publicDec = await createDecision(person, projectId, 'Activities are public', { approve: true });
  const guestsDec = await createDecision(person, projectId, 'Guests are allowed');
  const catalog = await createFeature(person, projectId, 'Activity catalog', {
    basedOn: { code: publicDec.code, version: 1 },
    approve: true,
  });
  const members = await createFeature(person, projectId, 'Members and access', {
    domain: 'members',
    basedOn: { code: guestsDec.code, version: 1 },
    approve: true,
  });
  const thread = await person.command(projectId, 'exploration.open', { purpose: 'Sign-ups' });
  await person.command(projectId, 'question.raise', {
    exploration_id: thread.entity_id,
    question: 'Is there a limit of places?',
  });
  const signUp = await createFeature(person, projectId, 'Sign up for an activity', {
    domain: 'signups',
    origin: { type: 'exploration', id: thread.entity_id },
  });
  const tech = await person.command<{ code: string }>(projectId, 'record.create', {
    type: 'adr',
    domain: 'stack',
    title: 'Postgres for everything',
    sections: [
      { title: 'Context', content: 'One database is simpler to run.' },
      { title: 'Options', content: 'Postgres, or Postgres and a queue.' },
      { title: 'Decision', content: 'Postgres for everything.' },
      { title: 'Consequences', content: 'Queues live in Postgres too.' },
    ],
  });
  const parked = await person.command(projectId, 'exploration.open', { purpose: 'Guest passes for trips' });
  await person.command(projectId, 'exploration.set_aside', { reason: 'After the pilot.' }, parked.entity_id);

  // The open legend sits over the bottom of the rail, in the same corner.
  await foldLegend(page);
  await page.goto(`/p/${projectId}/records/${signUp.code}`);
  const rail = railOf(page);
  await expect(rail.getByRole('link', { name: 'Club Activities' })).toHaveAttribute('href', `/p/${projectId}`);
  const item = (code: string) => rail.locator(`[data-rail-record="${code}"]`);
  // Features with the status of the overview: ready, needs you with its count, in doubt.
  await expect(item(catalog.code)).toContainText('Ready to build');
  await expect(item(signUp.code)).toContainText('Needs you');
  await expect(item(signUp.code).locator('[data-needs]')).toHaveAttribute('data-needs', '2');
  await expect(item(members.code)).toContainText('In doubt');
  // The one on screen is highlighted, and only that one.
  await expect(item(signUp.code)).toHaveAttribute('aria-current', 'page');
  await expect(rail.locator('[aria-current="page"]')).toHaveCount(1);
  // Decisions and tech decisions as nodes with their marks.
  await expect(item(publicDec.code).locator('[data-mark]')).toHaveAttribute('data-mark', 'confirmed');
  await expect(item(guestsDec.code).locator('[data-mark]')).toHaveAttribute('data-mark', 'proposed');
  await expect(item(tech.result?.code ?? '')).toContainText('Postgres for everything');
  // Rules come later; the parked thread links to itself.
  await expect(rail.locator('[data-later]')).toContainText('Later');
  const idea = rail.getByRole('link', { name: 'Guest passes for trips' });
  await expect(idea).toHaveAttribute('href', `/p/${projectId}/threads/${parked.entity_id}`);
  await expect(idea.locator('[data-mark]')).toHaveAttribute('data-mark', 'parked');
  // The links open the current version: no ?v.
  await expect(item(catalog.code)).toHaveAttribute('href', `/p/${projectId}/records/${catalog.code}`);
  await expectAccessible(page, 'the blueprint rail on a feature');

  // Opening a decision from the rail moves the highlight to it.
  await item(publicDec.code).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Activities are public' })).toBeVisible();
  await expect(item(publicDec.code)).toHaveAttribute('aria-current', 'page');
  await expect(rail.locator('[aria-current="page"]')).toHaveCount(1);
  await expectAccessible(page, 'the blueprint rail on a decision');

  // At 1280 px the rail, the record and its side panel fit without scrolling sideways.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/p/${projectId}/records/${catalog.code}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Activity catalog' })).toBeVisible();
  await expect(rail).toBeVisible();
  await expect(page.getByRole('complementary')).toBeVisible();
  await noHorizontalScroll(page);
  // The header keeps one line: the search is its magnifier until it has the focus.
  const needsYou = page.getByRole('banner').getByRole('link', { name: /Needs you/ });
  expect((await needsYou.boundingBox())?.height).toBeLessThanOrEqual(36);
  await page.keyboard.press('Control+k');
  await expect(searchOf(page)).toBeFocused();
  await expect.poll(async () => (await searchOf(page).boundingBox())?.width ?? 0).toBeGreaterThan(200);
});

test('AC-INT-001-08 the History tab tells who created and approved each version, and the Checks tab shows the checks', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('History');
  const dec = await createDecision(person, projectId, 'Activities are public', { approve: true });
  const fdr = await createFeature(person, projectId, 'Activity catalog', {
    basedOn: { code: dec.code, version: 1 },
    approve: true,
  });
  const v1 = (await recordOf(person, projectId, fdr.code)).versions[0];
  const [c1, c2, c3] = v1?.criteria ?? [];
  const sections = [
    { title: 'Goal', content: 'Members see every upcoming activity in one place.' },
    { title: 'Scope', content: 'The list of activities.' },
    { title: 'Out of scope', content: 'Signing up.' },
    { title: 'Behavior', content: 'Organizers publish and members see.' },
  ];
  const v2 = await person.command(projectId, 'record_version.create', {
    record_id: fdr.recordId,
    title: 'Activity catalog',
    sections,
    change_note: 'A new activity shows up quickly.',
    links: [{ type: 'based_on', target: { code: dec.code, version: 1 } }],
    criteria: [
      { carry: 'kept', code: c1?.code },
      { carry: 'kept', code: c2?.code },
      {
        carry: 'modified',
        derived_from: c3?.code,
        title: 'Shows up at once',
        statement: 'When an organizer publishes an activity, then members see it quickly in the catalog.',
        verification: 'manual',
        check: 'You publish one and look at the catalog.',
      },
    ],
  });
  await person.command(projectId, 'record_version.approve', {}, v2.entity_id);
  const v3 = await person.command(projectId, 'record_version.create', {
    record_id: fdr.recordId,
    title: 'Activity catalog',
    sections,
    change_note: 'Not needed after all.',
    links: [{ type: 'based_on', target: { code: dec.code, version: 1 } }],
    criteria: [
      { carry: 'kept', code: c1?.code },
      { carry: 'kept', code: c2?.code },
      { carry: 'kept', code: c3?.code },
    ],
  });
  await person.command(projectId, 'record_version.discard', { reason: 'Not needed.' }, v3.entity_id);

  await page.goto(`/p/${projectId}/records/${fdr.code}`);
  await sectionsOf(page).getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}/records/${fdr.code}?tab=history`);
  // In the diary's order: replacing v1 is part of approving v2, so it is written just before it.
  const lines = page.locator('[data-history-line]');
  await expect(lines).toHaveText([
    /Discarded v3/,
    /Created v3/,
    /Approved v2/,
    /v1 was replaced/,
    /Created v2/,
    /Approved v1/,
    /Created v1/,
  ]);
  await expect(lines.filter({ hasText: 'Approved v2' }).locator('[data-who]')).toHaveAttribute('data-who', 'you');
  await expect(lines.filter({ hasText: 'Created v1' }).locator('[data-who]')).toHaveAttribute('data-who', 'you');
  await expect(lines.filter({ hasText: 'v1 was replaced' }).locator('[data-who]')).toHaveAttribute('data-who', 'automatic');
  // Every version, with who wrote and approved it.
  const versions = page.getByRole('region', { name: 'Every version' });
  await expect(versions.locator('[data-history-version]')).toHaveCount(3);
  const second = versions.locator('[data-history-version="2"]');
  await expect(second).toContainText('Approved');
  await expect(second).toContainText('current');
  await expect(second).toContainText('A new activity shows up quickly.');
  await expect(second).toContainText('Written by you');
  await expect(second).toContainText('Approved by you');
  await expect(versions.locator('[data-history-version="1"] [data-mark]').first()).toHaveAttribute('data-mark', 'replaced');
  await expect(versions.locator('[data-history-version="3"] [data-mark]').first()).toHaveAttribute('data-mark', 'dropped');
  await expectAccessible(page, 'the History tab');

  // Checks: the checks of the version on screen, with who checks them and the verifiability warning.
  await sectionsOf(page).getByRole('link', { name: 'Checks · 3' }).click();
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}/records/${fdr.code}?tab=checks`);
  const checks = page.locator('[data-check]');
  await expect(checks).toHaveCount(3);
  await expect(checks.filter({ hasText: 'Shows up at once' }).locator('[data-who]')).toHaveAttribute('data-who', 'you');
  await expect(checks.filter({ hasText: 'Upcoming only' }).locator('[data-who]')).toHaveAttribute('data-who', 'automatic');
  await expect(checks.filter({ hasText: 'Shows up at once' }).locator('[data-verifiability]')).toContainText(
    '"quickly" is vague',
  );
  await expectAccessible(page, 'the Checks tab');

  // ?v is kept between the sections: v1's checks are the three of v1.
  await page.goto(`/p/${projectId}/records/${fdr.code}?v=1&tab=checks`);
  await expect(page.locator('[data-check]').filter({ hasText: 'Shows up at once' }).locator('[data-verifiability]')).toHaveCount(
    0,
  );
  await sectionsOf(page).getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}/records/${fdr.code}?v=1&tab=history`);
});

test('AC-INT-001-17 the header search finds a record by its words and Enter opens it', async ({ page, person }) => {
  const projectId = await person.createProject('Search');
  const dec = await createDecision(person, projectId, 'Activities are public', { approve: true });
  const fdr = await createFeature(person, projectId, 'Waitlist for full activities', {
    basedOn: { code: dec.code, version: 1 },
    approve: true,
  });
  await settled(person, projectId);

  await page.goto(`/p/${projectId}`);
  const search = searchOf(page);
  await expect(search).toHaveAttribute('placeholder', 'Search decisions, features, ideas');
  await search.fill('waitlist');
  const option = page.getByRole('option', { name: /Waitlist for full activities/ });
  await expect(option).toBeVisible();
  await expect(option.locator('mark')).toHaveText(['Waitlist']);
  await expect(option.locator('[data-mark]')).toHaveAttribute('data-mark', 'confirmed');
  await search.press('ArrowDown');
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await search.press('Enter');
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}/records/${fdr.code}?v=1`);
  await expect(page.getByRole('heading', { level: 1, name: 'Waitlist for full activities' })).toBeVisible();
  await expect(search).toHaveValue('');

  // A check opens the Checks of its record.
  await search.fill('soonest');
  const check = page.getByRole('option', { name: /Upcoming only/ });
  await expect(check).toBeVisible();
  await check.click();
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}/records/${fdr.code}?v=1&tab=checks`);

  // Nothing found says so; Esc closes and clears.
  await search.fill('zzzqqq');
  await expect(page.getByText('No matches')).toBeVisible();
  await expectAccessible(page, 'the header search without matches');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(page.getByText('No matches')).toBeHidden();
});

test('AC-WEB-001-03 the blueprint rail, the record tabs and the header search work with the keyboard only', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Keyboard blueprint');
  const dec = await createDecision(person, projectId, 'Activities are public', { approve: true });
  const catalog = await createFeature(person, projectId, 'Activity catalog', {
    basedOn: { code: dec.code, version: 1 },
    approve: true,
  });
  const waitlist = await createFeature(person, projectId, 'Waitlist for full activities', {
    domain: 'waiting',
    basedOn: { code: dec.code, version: 1 },
    approve: true,
  });
  const t = await threadWithAnswers(person, projectId, 'Sign-ups');
  const signUp = await createFeature(person, projectId, 'Sign up for an activity', {
    domain: 'signups',
    origin: { type: 'exploration', id: t.id },
  });
  await settled(person, projectId);

  await page.goto(`/p/${projectId}/records/${catalog.code}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Activity catalog' })).toBeVisible();

  // Ctrl+K goes to the search; the arrows choose and Enter opens.
  await page.keyboard.press('Control+k');
  const search = searchOf(page);
  await expect(search).toBeFocused();
  await page.keyboard.type('waitlist');
  const option = page.getByRole('option', { name: /Waitlist for full activities/ });
  await expect(option).toBeVisible();
  await expectAccessible(page, 'the header search with a result');
  await page.keyboard.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', (await option.getAttribute('id')) ?? '');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}/records/${waitlist.code}?v=1`);

  // The rail: Tab reaches it, the arrows move inside it and Enter opens.
  const rail = railOf(page);
  // Features go by code: Activity catalog, Sign up for an activity, Waitlist for full activities.
  await tabTo(page, rail.locator(`[data-rail-record="${catalog.code}"]`), 60);
  await page.keyboard.press('ArrowDown');
  await expect(rail.locator(`[data-rail-record="${signUp.code}"]`)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(rail.locator(`[data-rail-record="${waitlist.code}"]`)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(rail.locator(`[data-rail-record="${signUp.code}"]`)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}/records/${signUp.code}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign up for an activity' })).toBeVisible();

  // The sections: Tab reaches them and Enter opens each.
  const sections = sectionsOf(page);
  await tabTo(page, sections.getByRole('link', { name: 'Questions · 3' }), 60);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}/records/${signUp.code}?tab=questions`);
  await expect(page.locator('[data-open-questions] > [data-question]')).toHaveCount(3);

  // A question is set aside without the mouse.
  const pay = page.locator(`[data-question="${t.pay}"]`);
  await tabTo(page, pay.getByRole('button', { name: 'Not now' }), 30);
  await page.keyboard.press('Enter');
  const later = page.getByRole('dialog', { name: 'Leave it for later' });
  await expect(later.getByLabel('Reason')).toBeFocused();
  await page.keyboard.type('After the pilot.');
  await tabTo(page, later.getByRole('button', { name: 'Leave it for later' }), 5);
  await page.keyboard.press('Enter');
  await expect(later).toBeHidden();
  await expect(sections.getByRole('link', { name: 'Questions · 2' })).toBeVisible();
  await expect(markOf(page, t.pay)).toHaveAttribute('data-mark', 'parked');

  await tabTo(page, sections.getByRole('link', { name: 'History' }), 60, true);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}/records/${signUp.code}?tab=history`);
  await expect(page.locator('[data-history-line]').first()).toBeVisible();
  await expectAccessible(page, 'the History tab reached with the keyboard');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}/records/${signUp.code}?tab=checks`);
  await expect(page.locator('[data-check]')).toHaveCount(3);
});

test('screens of the blueprint: a feature with its rail, its questions, its checks, its history and the header search', async ({
  page,
  person,
}) => {
  test.setTimeout(150_000);
  await foldLegend(page);
  const projectId = await person.createProject('Club Activities');
  const publicDec = await createDecision(person, projectId, 'Activities are public', { approve: true });
  await createDecision(person, projectId, 'Only members can sign up', { approve: true });
  await createDecision(person, projectId, 'Guests are allowed');
  await createFeature(person, projectId, 'Activity catalog', {
    basedOn: { code: publicDec.code, version: 1 },
    approve: true,
  });
  const t = await threadWithAnswers(person, projectId, 'Sign-ups for club activities');
  const signUp = await createFeature(person, projectId, 'Sign up for an activity', {
    domain: 'signups',
    basedOn: { code: publicDec.code, version: 1 },
    origin: { type: 'exploration', id: t.id },
  });
  await createFeature(person, projectId, 'Members and access', { domain: 'members' });
  const parked = await person.command(projectId, 'exploration.open', { purpose: 'Guest passes' });
  await person.command(projectId, 'exploration.set_aside', { reason: 'After the pilot.' }, parked.entity_id);
  await settled(person, projectId);

  await page.goto(`/p/${projectId}/records/${signUp.code}`);
  await expect(railOf(page).locator(`[data-rail-record="${signUp.code}"]`)).toHaveAttribute('aria-current', 'page');
  await screenshot(page, 8, '01-blueprint-feature');

  await sectionsOf(page)
    .getByRole('link', { name: /Questions/ })
    .click();
  await page.locator(`[data-question="${t.assumed}"]`).getByRole('heading').click();
  await expect(page.getByRole('region', { name: 'If you confirm' })).toContainText('Who will use the product first');
  await page.locator(`[data-question="${t.assumed}"]`).scrollIntoViewIfNeeded();
  await screenshot(page, 8, '02-blueprint-questions');

  await sectionsOf(page)
    .getByRole('link', { name: /Checks/ })
    .click();
  await expect(page.locator('[data-check]').first()).toBeVisible();
  await screenshot(page, 8, '03-blueprint-checks');

  await sectionsOf(page).getByRole('link', { name: 'History' }).click();
  await expect(page.locator('[data-history-line]').first()).toBeVisible();
  await screenshot(page, 8, '04-blueprint-history');

  await searchOf(page).fill('activity');
  await expect(page.getByRole('option').first()).toBeVisible();
  await screenshot(page, 8, '05-header-search');
  await searchOf(page).press('Escape');

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/p/${projectId}/records/${signUp.code}?tab=questions`);
  await expect(page.locator('[data-open-questions] > [data-question]').first()).toBeVisible();
  await noHorizontalScroll(page);
  await screenshot(page, 8, '06-blueprint-1280-questions');
  await page.goto(`/p/${projectId}/records/${signUp.code}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign up for an activity' })).toBeVisible();
  await noHorizontalScroll(page);
  await screenshot(page, 8, '07-blueprint-1280-overview');
});

test('the header search finds a parked idea by the words of its purpose, in another form, and opens its thread', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Search ideas');
  const idea = (await person.command(projectId, 'exploration.open', { purpose: 'Parking spots for visitors' })).entity_id;
  await person.command(projectId, 'exploration.set_aside', { reason: 'Later.' }, idea);
  await page.goto(`/p/${projectId}`);
  const search = searchOf(page);
  await search.click();
  await search.fill('visitor');
  const hit = page.locator(`[data-search-result="exploration:${idea}"]`);
  await expect(hit).toContainText('Parking spots for visitors');
  await expect(hit).toContainText('Idea');
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page).toHaveURL((u) => u.pathname.endsWith(`/threads/${idea}`));
});
