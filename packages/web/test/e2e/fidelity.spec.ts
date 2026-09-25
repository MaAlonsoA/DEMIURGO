// The fidelity pass (DESIGN.md §3.5, §3.6): "Ask DEMIURGO about this" tied to what is on screen, the
// guided review of a draft feature over its own page, "You're up to date" when nothing is left, and
// the overview as an operational dashboard.

import type { Exploration, ExplorationDetail, RecordDetail, RunListItem } from '../../src/api/types.ts';
import { tabTo } from './needs-data.ts';
import { createDecision, createFeature, ratifiedProject, recordOf, settled, shot } from './record-setup.ts';
import { type PersonApi, expect, expectAccessible, screenshot, test } from './support/fixtures.ts';

const threadsOf = (person: PersonApi, projectId: string) => person.get<Exploration[]>(`/api/projects/${projectId}/explorations`);

/** The thread of a draft feature where DEMIURGO assumed an answer: the feature comes from it. */
async function featureWithAssumption(person: PersonApi, projectId: string) {
  const dec = await createDecision(person, projectId, 'Activities are public', { approve: true });
  const thread = await person.command(projectId, 'exploration.open', { purpose: 'Guest passes for open activities' });
  const url = `/api/projects/${projectId}/explorations/${thread.entity_id}`;
  // DEMIURGO asks the first stage's questions; what the person says next lets it assume an answer.
  await person.command(projectId, 'message.post', { exploration_id: thread.entity_id, text: 'Members bring guests.' });
  await person.until<ExplorationDetail>(url, (e) => e.questions.some((x) => x.state === 'pending'), 60_000);
  await person.command(projectId, 'message.post', { exploration_id: thread.entity_id, text: "Let's go with two guests." });
  await person.until<ExplorationDetail>(url, (e) => e.questions.some((x) => x.state === 'inferred'), 60_000);
  return createFeature(person, projectId, 'Guest passes', {
    basedOn: { code: dec.code, version: 1 },
    origin: { type: 'exploration', id: thread.entity_id },
  });
}

test('AC-INT-001-09 Ask DEMIURGO about a feature opens its thread and DEMIURGO answers there', async ({ page, person }) => {
  const projectId = await person.createProject('Ask about a feature');
  const fdr = await createFeature(person, projectId, 'Activity catalog');
  await page.goto(`/p/${projectId}/records/${fdr.code}`);

  const ask = page.getByRole('form', { name: 'Ask DEMIURGO about this feature' });
  const field = ask.getByRole('textbox');
  await expect(field).toHaveAttribute('placeholder', 'Ask about this feature, or suggest a change…');
  await field.fill('How do members find past activities?');
  await ask.getByRole('button', { name: 'Ask' }).click();
  const status = page.locator('[data-ask-status]');
  await expect(status).toContainText('About Activity catalog');
  await expect(status).toHaveAttribute('data-ask-status', 'answered', { timeout: 60_000 });
  await expect(status).toContainText('DEMIURGO answered');
  await expect(field).toHaveValue('');
  await expectAccessible(page, 'a record after asking DEMIURGO');

  // Its thread: born from the version on screen, with the question and DEMIURGO's answer.
  const born = (await threadsOf(person, projectId)).filter((t) => t.origin_type === 'record_version');
  expect(born.map((t) => [t.purpose, t.origin_id])).toEqual([['About Activity catalog', fdr.versionId]]);
  const threadId = born[0]?.id ?? '';

  // Asking again goes to the same thread.
  await field.fill('Can an organizer hide one of them?');
  await field.press('Enter');
  await expect(field).toHaveValue('');
  await expect(status).toHaveAttribute('data-ask-status', 'answered', { timeout: 60_000 });
  expect((await threadsOf(person, projectId)).filter((t) => t.origin_type === 'record_version')).toHaveLength(1);

  await status.getByRole('link', { name: /Open the thread/ }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${projectId}/threads/${threadId}$`));
  await expect(page.locator('[data-message-by="you"]')).toHaveCount(2);
  await expect(page.locator('[data-message-by="demiurgo"]').first()).toBeVisible();
});

test('AC-INT-001-09 Ask DEMIURGO about the whole product from the overview: its thread, the answer, and a run still working', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Club Activities');
  await createDecision(person, projectId, 'Members sign up themselves', { approve: true });
  await page.goto(`/p/${projectId}`);

  const ask = page.getByRole('form', { name: 'Ask DEMIURGO about the whole product' });
  await expect(page.getByRole('heading', { name: 'Ask DEMIURGO about the whole product' })).toBeVisible();
  const field = ask.getByRole('textbox');
  await expect(field).toHaveAttribute('placeholder', 'Ask or tell DEMIURGO anything about Club Activities');
  await field.fill('What should we design first?');
  await field.press('Enter');
  const status = page.locator('[data-ask-status]');
  await expect(status).toHaveAttribute('data-ask-status', 'answered', { timeout: 60_000 });
  await expect(status).toContainText('DEMIURGO answered');
  const about = (await threadsOf(person, projectId)).filter((t) => t.purpose === 'About the whole product');
  expect(about).toHaveLength(1);
  expect(about[0]?.origin_type).toBeNull();

  // While its run works, the status says DEMIURGO is answering; the same thread is used.
  await field.fill('[slow] Look at every activity before answering.');
  await ask.getByRole('button', { name: 'Ask' }).click();
  await expect(status).toHaveAttribute('data-ask-status', 'answering');
  await expect(status).toContainText('Sent to About the whole product · DEMIURGO is answering…');
  await expectAccessible(page, 'the overview while DEMIURGO answers');
  const threadId = about[0]?.id ?? '';
  const [working] = await person
    .until<RunListItem[]>(
      `/api/projects/${projectId}/runs?exploration=${threadId}`,
      (runs) => runs.some((r) => r.state === 'running'),
      45_000,
    )
    .then((runs) => runs.filter((r) => r.state === 'running'));
  expect((await threadsOf(person, projectId)).filter((t) => t.purpose === 'About the whole product')).toHaveLength(1);

  // A run that stops says why, in product words, next to the bar.
  await person.command(projectId, 'run.cancel', {}, working?.id);
  await expect(status).toHaveAttribute('data-ask-status', 'failed');
  await expect(status).toContainText("DEMIURGO couldn't answer: You cancelled it. Nothing was changed.");
});

test('AC-INT-001-09 capturing an idea from the overview saves it as a thread without leaving the page', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Capture an idea');
  const later = await person.command(projectId, 'exploration.open', { purpose: 'Guest passes for open activities' });
  await person.command(projectId, 'exploration.set_aside', { reason: 'After the pilot.' }, later.entity_id);
  await page.goto(`/p/${projectId}`);
  const main = page.getByRole('main');

  // A thread set aside is a parked idea, with its state in words and the way back to it; who uses it
  // and the rules wait for later.
  await expect(main.getByRole('heading', { name: /^Parked ideas/ })).toBeVisible();
  const parked = main.locator(`[data-parked="${later.entity_id}"]`);
  await expect(parked.locator('[data-status="parked"]')).toBeVisible();
  await expect(parked).toContainText('Set aside');
  await expect(parked).toContainText('Guest passes for open activities');
  await expect(parked).toContainText('After the pilot.');
  await expect(parked.getByRole('link', { name: 'Guest passes for open activities' })).toHaveAttribute(
    'href',
    `/p/${projectId}/threads/${later.entity_id}`,
  );
  await expect(main.locator('[data-later]')).toContainText('Who uses it');
  await expect(main.locator('[data-later]')).toContainText('Later');

  await main.getByRole('button', { name: 'Capture an idea' }).click();
  const dialog = page.getByRole('dialog');
  const save = dialog.getByRole('button', { name: 'Save as a thread' });
  await expect(save).toBeDisabled();
  await dialog.getByLabel('Your idea').fill('Members rate the activities they went to.');
  await save.click();
  await expect(dialog).toBeHidden();
  const saved = main.locator('[data-captured]');
  await expect(saved).toContainText('Saved as a thread');
  await expect(page).toHaveURL(new RegExp(`/p/${projectId}$`));
  await expectAccessible(page, 'the overview after capturing an idea');

  // A thread with the idea as its purpose; DEMIURGO was not asked anything.
  const idea = (await threadsOf(person, projectId)).find((t) => t.purpose === 'Members rate the activities they went to.');
  expect(idea?.state).toBe('active');
  const detail = await person.get<ExplorationDetail>(`/api/projects/${projectId}/explorations/${idea?.id ?? ''}`);
  expect(detail.messages).toHaveLength(0);
  expect(await person.get<RunListItem[]>(`/api/projects/${projectId}/runs?exploration=${idea?.id ?? ''}`)).toHaveLength(0);
  await saved.getByRole('link', { name: /Open the thread/ }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${projectId}/threads/${idea?.id ?? ''}$`));
});

test('AC-INT-001-05 the guided review walks the five parts of a draft feature and Confirm approves it without creating a version', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Review a feature');
  const dec = await createDecision(person, projectId, 'Activities are public', { approve: true });
  const fdr = await createFeature(person, projectId, 'Activity catalog', { basedOn: { code: dec.code, version: 1 } });
  await page.goto(`/p/${projectId}/records/${fdr.code}`);

  const banner = page.locator('[data-review-banner]');
  await expect(banner).toContainText('Review it: context, details and 3 checks');
  await expect(banner).toContainText('5 short parts · about 2 minutes. Nothing is final until you confirm.');
  await banner.getByRole('button', { name: 'Start review' }).click();

  const bar = page.getByRole('region', { name: 'Review' });
  const label = bar.locator('[data-review-label]');
  const walk: [string, string | null][] = [
    ['Part 1 of 5 · Context', 'context'],
    ["Part 2 of 5 · What it's for", 'what'],
    ['Part 3 of 5 · How it works', 'how'],
    ['Part 4 of 5 · Checks', 'checks'],
    ['Part 5 of 5 · What DEMIURGO assumed', null],
  ];
  for (const [text, key] of walk) {
    await expect(label).toHaveText(text);
    // The part under review is outlined and labelled; nothing else is dimmed (INVENTORY §2 #16).
    await expect(page.locator('[data-dimmed]')).toHaveCount(0);
    if (key) {
      const active = page.locator(`[data-review-part="${key}"]`);
      await expect(active).toHaveAttribute('data-review-active', 'true');
      await expect(active.locator('[data-review-flag]')).toHaveText(text);
      await expect(page.locator('[data-review-active="true"]')).toHaveCount(1);
    } else {
      await expect(bar).toContainText('Nothing assumed');
      await expect(page.locator('[data-review-active="true"]')).toHaveCount(0);
    }
    await bar.getByRole('button', { name: 'Looks right' }).click();
  }

  // At the end, the whole page again and Confirm, which asks first and says what it means.
  await expect(label).toHaveText('All 5 parts reviewed');
  await expect(bar).toContainText('Confirm Activity catalog?');
  await expect(page.locator('[data-review-active="true"]')).toHaveCount(0);
  await bar.getByRole('button', { name: 'Confirm', exact: true }).click();
  // The dialog's button says the same word as the bar's (INVENTORY INV-REC, label mismatch).
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('It becomes the current version. It is Ready to build if nothing else blocks it.');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).toBeHidden();

  // Ready to build (canvas S5D): approved, current, and no new version.
  await expect(bar).toBeHidden();
  await expect(page.locator('[data-record-header] [data-version-state] [data-status]')).toHaveAttribute(
    'data-status',
    'confirmed',
  );
  await expect(page.locator('[data-ready-banner]')).toContainText('Activity catalog is ready to build');
  await expect(page.getByRole('region', { name: 'Versions' }).locator('[data-version]')).toHaveCount(1);
  const after: RecordDetail = await recordOf(person, projectId, fdr.code);
  expect(after.versions.map((v) => [v.n, v.state])).toEqual([[1, 'approved']]);
  expect(after.current).toBe(1);
});

test('AC-INT-001-09 in the review, Change something asks DEMIURGO in the thread of the feature, or offers a new version', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Change something');
  const fdr = await createFeature(person, projectId, 'Activity catalog');
  await page.goto(`/p/${projectId}/records/${fdr.code}`);
  await page.getByRole('button', { name: 'Start review' }).click();
  const bar = page.getByRole('region', { name: 'Review' });
  await bar.getByRole('button', { name: 'Looks right' }).click();
  await expect(bar.locator('[data-review-label]')).toHaveText("Part 2 of 5 · What it's for");

  await bar.getByRole('button', { name: 'Change something' }).click();
  const field = page.getByRole('form', { name: 'Ask DEMIURGO about this feature' }).getByRole('textbox');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("In What it's for: ");
  await expect(bar.getByRole('link', { name: 'New version' })).toHaveAttribute(
    'href',
    `/p/${projectId}/records/${fdr.code}/new-version`,
  );
  await field.pressSequentially('past activities should be in the catalog too.');
  await field.press('Enter');
  await expect(page.locator('[data-ask-status]')).toHaveAttribute('data-ask-status', 'answered', { timeout: 60_000 });
  // The review goes on where it was, and nothing was approved.
  await expect(bar.locator('[data-review-label]')).toHaveText("Part 2 of 5 · What it's for");
  const thread = (await threadsOf(person, projectId)).find((t) => t.origin_id === fdr.versionId);
  const detail = await person.get<ExplorationDetail>(`/api/projects/${projectId}/explorations/${thread?.id ?? ''}`);
  expect(detail.messages.find((m) => m.author.startsWith('human:'))?.body).toBe(
    "In What it's for: past activities should be in the catalog too.",
  );

  await bar.getByRole('button', { name: 'Leave review' }).click();
  await expect(bar).toBeHidden();
  await expect(page.locator('[data-review-banner]')).toBeVisible();
  await expect(page.locator('[data-review-active="true"]')).toHaveCount(0);
  expect((await recordOf(person, projectId, fdr.code)).versions.map((v) => v.state)).toEqual(['draft']);
});

test('AC-WEB-001-03 the guided review works with the keyboard only', async ({ page, person }) => {
  test.setTimeout(150_000);
  const projectId = await person.createProject('Review with the keyboard');
  const fdr = await featureWithAssumption(person, projectId);
  await page.goto(`/p/${projectId}/records/${fdr.code}`);
  const start = page.getByRole('button', { name: 'Start review' });
  await expect(start).toBeVisible();
  await expectAccessible(page, 'a draft feature with its review banner');

  // Start, then leave at once: the focus comes back to Start review.
  await tabTo(page, start);
  await page.keyboard.press('Enter');
  const bar = page.getByRole('region', { name: 'Review' });
  const ok = bar.getByRole('button', { name: 'Looks right' });
  await expect(ok).toBeFocused();
  await tabTo(page, bar.getByRole('button', { name: 'Leave review' }), 10, true);
  await page.keyboard.press('Enter');
  await expect(bar).toBeHidden();
  await expect(start).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(ok).toBeFocused();
  const label = bar.locator('[data-review-label]');
  for (const [n, key] of [
    [1, 'context'],
    [2, 'what'],
    [3, 'how'],
    [4, 'checks'],
    [5, 'assumed'],
  ] as const) {
    await expect(label).toContainText(`Part ${n} of 5`);
    await expect(page.locator(`[data-review-part="${key}"]`)).toHaveAttribute('data-review-active', 'true');
    // Nothing is dimmed, so axe checks the whole page as it is.
    await expectAccessible(page, `part ${n} of the review`);
    await page.keyboard.press('Enter');
  }
  // What DEMIURGO assumed was a real part: its assumed answer was on screen.
  const confirm = bar.getByRole('button', { name: 'Confirm', exact: true });
  await expect(confirm).toBeFocused();
  await expectAccessible(page, 'the end of the review');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await tabTo(page, dialog.getByRole('button', { name: 'Confirm', exact: true }), 5);
  await expectAccessible(page, 'the confirmation of the review');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-record-header] [data-version-state] [data-status]')).toHaveAttribute(
    'data-status',
    'confirmed',
  );
  // The bar is gone: the focus is on the page's title, never lost to the body.
  await expect(page.locator('#page-title')).toBeFocused();
  expect((await recordOf(person, projectId, fdr.code)).versions.map((v) => [v.n, v.state])).toEqual([[1, 'approved']]);
  await expectAccessible(page, 'the feature after the review');
});

test('screens of the fidelity pass: the overview as the blueprint, Ask DEMIURGO, the guided review and up to date', async ({
  page,
  person,
}) => {
  test.setTimeout(240_000);
  const projectId = await ratifiedProject(person, 'DEMIURGO');
  for (const code of ['DEC-PLN-001', 'FDR-INT-001']) {
    const r = await recordOf(person, projectId, code);
    await person.command(projectId, 'record_version.approve', {}, r.versions[0]?.id);
  }
  const thread = await person.command(projectId, 'exploration.open', { purpose: 'Guests at activities' });
  const dec = await createDecision(person, projectId, 'Guests are allowed', { approve: true });
  await createFeature(person, projectId, 'Guest passes', {
    basedOn: { code: dec.code, version: 1 },
    origin: { type: 'exploration', id: thread.entity_id },
  });
  await settled(person, projectId);

  await page.goto(`/p/${projectId}`);
  const ask = page.getByRole('form', { name: 'Ask DEMIURGO about the whole product' });
  await ask.getByRole('textbox').fill('Which feature should we review first?');
  await ask.getByRole('button', { name: 'Ask' }).click();
  await expect(page.locator('[data-ask-status]')).toHaveAttribute('data-ask-status', 'answered', { timeout: 60_000 });
  await screenshot(page, 8, '02-overview-asked');

  await page.goto(`/p/${projectId}/records/FDR-DIS-001`);
  await expect(page.locator('[data-review-banner]')).toBeVisible();
  await screenshot(page, 8, '03-record-review-banner');
  await page.getByRole('button', { name: 'Start review' }).click();
  const bar = page.getByRole('region', { name: 'Review' });
  await expect(bar.locator('[data-review-label]')).toHaveText('Part 1 of 5 · Context');
  await screenshot(page, 8, '04-review-context');
  await shot(page, 'review-context');
  await bar.getByRole('button', { name: 'Looks right' }).click();
  await expect(bar.locator('[data-review-label]')).toHaveText("Part 2 of 5 · What it's for");
  await screenshot(page, 8, '05-review-what');
  await shot(page, 'review-what');
  await bar.getByRole('button', { name: 'Change something' }).click();
  await screenshot(page, 8, '06-review-change');
  await shot(page, 'review-change');
  for (let i = 0; i < 2; i++) await bar.getByRole('button', { name: 'Looks right' }).click();
  await expect(bar.locator('[data-review-label]')).toHaveText('Part 4 of 5 · Checks');
  await screenshot(page, 8, '07-review-checks');
  for (let i = 0; i < 2; i++) await bar.getByRole('button', { name: 'Looks right' }).click();
  await expect(bar.locator('[data-review-label]')).toHaveText('All 5 parts reviewed');
  await screenshot(page, 8, '08-review-confirm');
  await shot(page, 'review-final');
  await bar.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await screenshot(page, 8, '09-review-confirm-dialog');
  await shot(page, 'review-confirm-dialog');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(bar).toBeHidden();
  await screenshot(page, 8, '10-record-after-review');

  const fdrAsk = page.getByRole('form', { name: 'Ask DEMIURGO about this feature' });
  await fdrAsk.getByRole('textbox').fill('What does it need before it can be built?');
  await fdrAsk.getByRole('button', { name: 'Ask' }).click();
  await expect(page.locator('[data-ask-status]')).toHaveAttribute('data-ask-status', 'answered', { timeout: 60_000 });
  await screenshot(page, 8, '11-record-asked');

  // DEMIURGO at work (last: a slow run would slow down every answer after it): answering in the
  // thread of a feature, and drafting a new one from a decision.
  await person.command(projectId, 'message.post', {
    exploration_id: thread.entity_id,
    text: '[slow] How many guests can a member bring?',
  });
  const slow = await person.command<{ versionId: string }>(projectId, 'record.create', {
    type: 'decision',
    domain: 'events',
    title: 'Members invite guests',
    sections: [
      { title: 'Context', content: 'Members want to bring friends.' },
      { title: 'Decision', content: 'Members can invite guests.' },
      { title: 'Consequences', content: 'Invitations are counted [slow].' },
    ],
  });
  const slowVersion = slow.result?.versionId ?? '';
  await person.command(projectId, 'record_version.approve', {}, slowVersion);
  await settled(person, projectId);
  await person.command(projectId, 'run.request', {
    action: 'design_proposal',
    scope: { type: 'record_version', id: slowVersion },
  });
  await person.until<RunListItem[]>(
    `/api/projects/${projectId}/runs`,
    (runs) => runs.filter((r) => r.state === 'running').length === 2,
    60_000,
  );
  await page.goto(`/p/${projectId}`);
  const main = page.getByRole('main');
  // Where each feature is, without a pill: the first bar full when ready, the amber Working signal while DEMIURGO works.
  await expect(main.locator('[data-record] [data-stage="ready"]').first()).toBeVisible();
  await expect(main.locator('[data-feature-working]')).toBeVisible();
  await expect(main.locator('[data-drafting]')).toBeVisible();
  await screenshot(page, 8, '01-overview');
  await shot(page, 'overview-working');
  await expectAccessible(page, 'the overview as the blueprint');

  const quiet = await person.createProject('Club Activities');
  await createDecision(person, quiet, 'Members sign up themselves', { approve: true });
  const q = await person.command(quiet, 'exploration.open', { purpose: 'Guests at activities' });
  await person.command(quiet, 'message.post', { exploration_id: q.entity_id, text: '[slow] Think about guests first.' });
  await person.until<RunListItem[]>(`/api/projects/${quiet}/runs`, (runs) => runs.some((r) => r.state === 'running'), 45_000);
  await person.until<{ total: number }>(`/api/projects/${quiet}/inbox`, (i) => i.total === 0, 45_000);
  await page.goto(`/p/${quiet}/needs-you`);
  await expect(page.getByText('Nothing needs you. You can close DEMIURGO.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'In progress' }).locator('[data-run], [data-running]')).toHaveCount(1);
  await screenshot(page, 8, '12-up-to-date');
});
