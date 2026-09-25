// The product overview (DESIGN.md §3.5): every record by its certainty, the side column in Catch up's
// order, the side preview that replaced the hover peek (D-015), and the screens of cut 2.

import type { ProductState, Readiness } from '../../src/api/types.ts';
import { expectNoSideScroll, ratifiedProject, readinessOf, recordOf, shot } from './record-setup.ts';
import { BASE_URL, expect, expectAccessible, screenshot, test } from './support/fixtures.ts';

const MARK_OF: Record<string, string> = { confirmed: 'confirmed', proposed: 'proposed', pending: 'open', unknown: 'unknown' };

test('AC-INT-001-04 just ratified, every record on the overview is Proposed and Needs you offers to start with the versions to approve', async ({
  page,
  person,
}) => {
  const projectId = await ratifiedProject(person, 'Just ratified');
  const state = await person.get<ProductState>(`/api/projects/${projectId}/state`);
  await page.goto(`/p/${projectId}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: state.project.name })).toBeVisible();
  await expect(main.getByRole('heading', { name: /^Features/ })).toBeVisible();

  for (const row of [...state.designs, ...state.decisions]) {
    const element = main.locator(`[data-record="${row.code}"]`);
    await expect(element, row.code).toBeVisible();
    await expect(element.locator('[data-certainty] [data-status]')).toHaveAttribute('data-status', 'proposed');
  }
  // Ratifying approves nothing: nothing in the product is Confirmed yet.
  await expect(main.locator('[data-certainty] [data-status="confirmed"]')).toHaveCount(0);
  const features = state.designs.filter((r) => r.type === 'fdr');
  for (const f of features)
    await expect(main.locator(`[data-record="${f.code}"] [data-stage]`)).toHaveAttribute('data-stage', 'not-ready');

  const aside = page.getByRole('complementary');
  const start = aside.getByRole('link', { name: 'Start with the versions to approve' });
  await expect(start).toBeVisible();
  await expect(aside.getByText('Nothing is ready to build yet.')).toBeVisible();
  await expectAccessible(page, 'the overview just ratified');

  await start.click();
  // The first version to approve: most records are at v1, ADR-AGE-001 at v2.
  await expect(page).toHaveURL(/\/records\/[A-Z]{3}-[A-Z]{3}-\d{3}\?v=\d+$/);
  await expect(page.locator('[data-record-actions]').getByRole('button', { name: 'Approve' })).toBeVisible();
});

test('AC-INT-001-04 the overview marks each element by its epistemic state and nothing an agent proposed looks Confirmed', async ({
  page,
  person,
}) => {
  const projectId = await ratifiedProject(person, 'Marks on the overview');
  for (const code of ['DEC-PLN-001', 'FDR-INT-001']) {
    const r = await recordOf(person, projectId, code);
    await person.command(projectId, 'record_version.approve', {}, r.versions[0]?.id);
  }
  const thread = await person.command(projectId, 'exploration.open', { purpose: 'Guests at activities' });
  await person.command(projectId, 'question.raise', {
    exploration_id: thread.entity_id,
    question: 'How many guests per member?',
  });
  const agent = await person.agent(projectId);
  await agent.command('batch.submit', {
    summary: 'Guests',
    proposals: [
      {
        type: 'decision',
        payload: {
          title: 'Two guests per member',
          context: 'Members ask to bring friends.',
          decision: 'Each member can bring two guests.',
          consequences: 'Places are counted with the guests.',
        },
      },
    ],
  });

  const state = await person.get<ProductState>(`/api/projects/${projectId}/state`);
  await page.goto(`/p/${projectId}`);
  const main = page.getByRole('main');
  const certainty = (code: string) => main.locator(`[data-record="${code}"] [data-certainty] [data-status]`);
  for (const row of [...state.designs, ...state.decisions]) {
    await expect(certainty(row.code), row.code).toHaveAttribute('data-status', MARK_OF[row.epistemic_status] ?? 'unknown');
  }
  await expect(certainty('FDR-INT-001')).toHaveAttribute('data-status', 'confirmed');
  await expect(certainty('DEC-PLN-001')).toHaveAttribute('data-status', 'confirmed');
  await expect(certainty('FDR-DIS-001')).toHaveAttribute('data-status', 'proposed');

  // Approved and nothing blocks it: Ready to build, and it is in the "Ready to build" list.
  await expect(main.locator('[data-record="FDR-INT-001"] [data-stage]')).toHaveAttribute('data-stage', 'ready');
  const aside = page.getByRole('complementary');
  const ready = aside.getByRole('region', { name: 'Ready to build' });
  const fdr = state.designs.find((r) => r.code === 'FDR-INT-001');
  await expect(ready.getByRole('link', { name: fdr?.title ?? 'FDR-INT-001' })).toBeVisible();

  // The thread with an open question, with its real state in words.
  const node = main.locator(`[data-thread="${thread.entity_id}"]`);
  await expect(node).toContainText('Guests at activities');
  await expect(node.locator('[data-status]').first()).toHaveAttribute('data-status', 'open');
  await expect(node).toContainText('Active');

  // What the agent proposed waits in Needs you as Proposed, never Confirmed.
  const needs = aside.getByRole('region', { name: 'Needs you' });
  const proposal = needs.locator('[data-needs-item="proposal"]').filter({ hasText: /Guests|Two guests/ });
  await expect(proposal).toBeVisible();
  await expect(proposal.locator('[data-status]').first()).toHaveAttribute('data-status', 'proposed');
  await expect(needs.locator('[data-needs-item="proposal"] [data-status="confirmed"]')).toHaveCount(0);
  await expect(needs.getByRole('link', { name: 'Catch up' })).toHaveAttribute('href', `/p/${projectId}/needs-you?catch-up=1`);
  await expectAccessible(page, 'the overview');
});

test('AC-WEB-001-03 on the overview a card opens its Preview with the keyboard, Esc returns the focus, and its title opens the record', async ({
  page,
  person,
}) => {
  // The hover "peek" is gone (D-015): the same facts open in a side preview from a visible button.
  const projectId = await ratifiedProject(person, 'Preview');
  const r = await recordOf(person, projectId, 'FDR-DIS-001');
  const readiness: Readiness = await readinessOf(person, projectId, r.versions[0]?.id ?? '');
  await page.goto(`/p/${projectId}`);
  const card = page.getByRole('main').locator('[data-record="FDR-DIS-001"]');
  const preview = card.getByRole('button', { name: /^Preview De la intención/ });
  await preview.focus();
  await page.keyboard.press('Enter');

  const sheet = page.getByRole('dialog', { name: /De la intención/ });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('FDR-DIS-001 · v1')).toBeVisible();
  for (const reason of readiness.reasons) await expect(sheet.getByText(reason, { exact: true })).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Open' })).toHaveAttribute('href', `/p/${projectId}/records/FDR-DIS-001`);
  await expectAccessible(page, 'the preview of a feature');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(preview).toBeFocused();

  // One click, or Enter on its title, opens the full page.
  const title = card.getByRole('link', { name: /De la intención a «Listo para construir»/ });
  await title.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}/records/FDR-DIS-001`);
  await expect(page.getByRole('heading', { level: 1, name: /De la intención/ })).toBeVisible();
});

test('screens of cut 2: the overview just ratified, a feature preview, a record page and a record ready to build', async ({
  page,
  person,
}) => {
  const projectId = await ratifiedProject(person, 'DEMIURGO');
  await page.goto(`/p/${projectId}`);
  await expect(page.getByRole('main').locator('[data-record="FDR-DIS-001"]')).toBeVisible();
  await screenshot(page, 2, '01-overview-ratified');
  await shot(page, 'overview-ratified');
  await shot(page, 'overview-ratified-full', true);

  await page
    .getByRole('main')
    .locator('[data-record="FDR-DIS-001"]')
    .getByRole('button', { name: /^Preview/ })
    .click();
  await expect(page.getByRole('dialog', { name: /De la intención/ })).toBeVisible();
  await screenshot(page, 2, '02-card-preview');
  await shot(page, 'overview-preview');
  await page.keyboard.press('Escape');

  await page.goto(`/p/${projectId}/records/FDR-DIS-001`);
  await expect(page.getByRole('heading', { level: 1, name: /De la intención/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Context' }).locator('[data-link-target="DEC-PLN-001"]')).toBeVisible();
  await screenshot(page, 2, '03-record');
  await shot(page, 'record-draft');
  await shot(page, 'record-draft-full', true);
  await expectAccessible(page, 'a record page');
  await page.locator('[data-check]').first().scrollIntoViewIfNeeded();
  await screenshot(page, 2, '03b-record-checks');

  for (const code of ['DEC-PLN-001', 'FDR-INT-001']) {
    const r = await recordOf(person, projectId, code);
    await person.command(projectId, 'record_version.approve', {}, r.versions[0]?.id);
  }
  await page.goto(`/p/${projectId}/records/FDR-INT-001`);
  await expect(page.getByRole('complementary').getByRole('heading', { name: 'Ready to build' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Context' }).locator('[data-link-target="DEC-PLN-001"]')).toBeVisible();
  await expect(page.getByRole('link', { name: /^Next: / })).toBeVisible();
  await screenshot(page, 2, '04-record-ready');
  await shot(page, 'record-ready');

  await page.goto(`/p/${projectId}`);
  await expect(page.getByRole('main').locator('[data-record="FDR-INT-001"] [data-stage]')).toHaveAttribute('data-stage', 'ready');
  await screenshot(page, 2, '05-overview-one-ready');
  await shot(page, 'overview-one-ready');

  // Reflow: the overview and a record at a phone's width, without scrolling sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/p/${projectId}`);
  await expect(page.getByRole('main').locator('[data-record="FDR-INT-001"]')).toBeVisible();
  await expectNoSideScroll(page, 'the overview at 390 px');
  await shot(page, 'overview-390');
  await shot(page, 'overview-390-full', true);
  await page.goto(`/p/${projectId}/records/FDR-INT-001`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoSideScroll(page, 'a record at 390 px');
  await shot(page, 'record-390');
  await shot(page, 'record-390-full', true);

  // The dark theme follows the system: the same screens, only with its tokens.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`/p/${projectId}/records/FDR-INT-001`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await shot(page, 'record-dark');
  await page.goto(`/p/${projectId}`);
  await expect(page.getByRole('main').locator('[data-record="FDR-INT-001"]')).toBeVisible();
  await shot(page, 'overview-dark');
  await expectAccessible(page, 'the overview in the dark theme');
});

test('the design stages: started from the overview, the open one says why it may not pass yet, and passing asks first', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Stages');
  await page.goto(`/p/${projectId}`);
  const stages = page.getByRole('region', { name: /^Product design/ });
  await stages.getByRole('button', { name: 'Start design stages' }).click();
  // The first stage opens; the steps say their state in words and how many questions are answered.
  const first = stages.getByRole('tab', { name: /Product definition/ });
  await expect(first.locator('[data-status]')).toHaveAttribute('data-status', 'open');
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(stages).toContainText('now: Product definition');
  const detail = stages.getByRole('tabpanel');
  await expect(detail.locator('[data-why-not]')).toContainText(/Not ready to pass: \d+ of \d+ questions still need an answer\./);
  await expect(detail.getByRole('link', { name: 'Open the thread of Product definition' })).toBeVisible();
  await expectAccessible(page, 'the design stages with the first one open');
  await shot(page, 'overview-stages');

  // Another step shows its own detail; the arrows move between the steps.
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(stages.getByRole('tab', { name: /Global quality/ })).toBeFocused();
  await expect(stages.getByRole('tabpanel')).toContainText('It opens when the stage before it passes.');
  await page.keyboard.press('ArrowLeft');

  // Passing is decisive: it asks first, and the server's reasons show inside the dialog.
  await stages.getByRole('tabpanel').getByRole('button', { name: 'Pass stage' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Pass Product definition?' });
  await expect(confirm).toContainText('Global quality opens next.');
  await confirm.getByRole('button', { name: 'Pass stage' }).click();
  await expect(confirm.locator('[data-reasons]')).toBeVisible();
  await confirm.getByRole('button', { name: 'Not now' }).click();
  await expect(confirm).toBeHidden();
  await expect(stages.getByRole('tabpanel').getByRole('button', { name: 'Pass stage' })).toBeFocused();
});
