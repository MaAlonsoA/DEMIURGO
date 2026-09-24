import type { ProductState, Readiness } from '../../src/api/types.ts';
import { foldLegend, recordOf, ratifiedProject, readinessOf } from './record-setup.ts';
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
    await expect(element.locator('[data-status] [data-mark]')).toHaveAttribute('data-mark', 'proposed');
  }
  // Ratifying approves nothing: nothing in the product is Confirmed yet.
  await expect(main.locator('[data-mark="confirmed"]')).toHaveCount(0);
  const features = state.designs.filter((r) => r.type === 'fdr');
  for (const f of features)
    await expect(main.locator(`[data-record="${f.code}"] [data-stage]`)).toHaveAttribute('data-stage', 'not-ready');

  const aside = page.getByRole('complementary');
  const start = aside.getByRole('link', { name: 'Start with the versions to approve' });
  await expect(start).toBeVisible();
  await expect(aside.getByText('Nothing is ready to build yet.')).toBeVisible();
  await expectAccessible(page, 'the overview just ratified');

  await start.click();
  await expect(page).toHaveURL(/\/records\/[A-Z]{3}-[A-Z]{3}-\d{3}\?v=1$/);
  await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
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
  for (const row of [...state.designs, ...state.decisions]) {
    const expected = MARK_OF[row.epistemic_status] ?? 'unknown';
    await expect(main.locator(`[data-record="${row.code}"] [data-status] [data-mark]`), row.code).toHaveAttribute(
      'data-mark',
      expected,
    );
  }
  await expect(main.locator('[data-record="FDR-INT-001"] [data-status] [data-mark]')).toHaveAttribute('data-mark', 'confirmed');
  await expect(main.locator('[data-record="DEC-PLN-001"] [data-status] [data-mark]')).toHaveAttribute('data-mark', 'confirmed');
  await expect(main.locator('[data-record="FDR-DIS-001"] [data-status] [data-mark]')).toHaveAttribute('data-mark', 'proposed');

  // Approved and nothing blocks it: the first bar is full and it is in "Ready to build".
  await expect(main.locator('[data-record="FDR-INT-001"] [data-stage]')).toHaveAttribute('data-stage', 'ready');
  const aside = page.getByRole('complementary');
  const ready = aside.getByRole('region', { name: 'Ready to build' });
  const fdr = state.designs.find((r) => r.code === 'FDR-INT-001');
  await expect(ready.getByRole('link', { name: fdr?.title ?? 'FDR-INT-001' })).toBeVisible();

  // The thread with an open question, with its mark.
  const node = main.locator(`[data-thread="${thread.entity_id}"]`);
  await expect(node).toContainText('Guests at activities');
  await expect(node.locator('[data-mark]').first()).toHaveAttribute('data-mark', 'open');

  // What the agent proposed waits in Needs you as Proposed, never Confirmed.
  const needs = aside.getByRole('region', { name: 'Needs you' });
  const proposal = needs.locator('[data-needs-item="proposal"]').filter({ hasText: /Guests|Two guests/ });
  await expect(proposal).toBeVisible();
  await expect(proposal.locator('[data-mark]').first()).toHaveAttribute('data-mark', 'proposed');
  await expect(needs.locator('[data-needs-item="proposal"] [data-mark="confirmed"]')).toHaveCount(0);
  await expect(needs.getByRole('link', { name: 'Catch up' })).toHaveAttribute('href', `/p/${projectId}/needs-you?catch-up=1`);
  await expectAccessible(page, 'the overview');
});

test('AC-WEB-001-03 on the overview a card shows its peek on focus and pointing, and Enter opens its record', async ({
  page,
  person,
}) => {
  const projectId = await ratifiedProject(person, 'Peek');
  const r = await recordOf(person, projectId, 'FDR-DIS-001');
  const readiness: Readiness = await readinessOf(person, projectId, r.versions[0]?.id ?? '');
  await page.goto(`/p/${projectId}`);
  const card = page.getByRole('main').getByRole('link', { name: /De la intención a «Listo para construir»/ });
  await expect(card).toBeVisible();

  // Pointing for a moment shows the detail beside the card: code and version in mono, the readiness reasons as they come.
  await card.hover();
  const peek = page.getByRole('dialog', { name: /De la intención/ });
  await expect(peek).toBeVisible();
  await expect(peek.getByText('FDR-DIS-001 · v1')).toBeVisible();
  for (const reason of readiness.reasons) await expect(peek.getByText(reason, { exact: true })).toBeVisible();
  await expect(peek.getByRole('link', { name: 'Open' })).toHaveAttribute('href', `/p/${projectId}/records/FDR-DIS-001`);
  await page.mouse.move(0, 0);
  await expect(peek).toBeHidden();

  // With the keyboard: focus shows the peek, Enter opens the full page.
  await card.focus();
  await expect(page.getByRole('dialog', { name: /De la intención/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}/records/FDR-DIS-001`);
  await expect(page.getByRole('heading', { level: 1, name: /De la intención/ })).toBeVisible();
});

test('screens of cut 2: the overview just ratified, a feature card peek, a record page and a record ready to build', async ({
  page,
  person,
}) => {
  const projectId = await ratifiedProject(person, 'DEMIURGO');
  await foldLegend(page);
  await page.goto(`/p/${projectId}`);
  await expect(page.getByRole('main').locator('[data-record="FDR-DIS-001"]')).toBeVisible();
  await screenshot(page, 2, '01-overview-ratified');

  // A click keeps the peek open while the pointer goes away.
  await page
    .getByRole('main')
    .getByRole('link', { name: /De la intención a «Listo para construir»/ })
    .click();
  await expect(page.getByRole('dialog', { name: /De la intención/ })).toBeVisible();
  await screenshot(page, 2, '02-card-peek');
  await expect(page.getByRole('dialog', { name: /De la intención/ })).toBeVisible();

  await page.goto(`/p/${projectId}/records/FDR-DIS-001`);
  await expect(page.getByRole('heading', { level: 1, name: /De la intención/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Context' }).locator('[data-link-target="DEC-PLN-001"]')).toBeVisible();
  await screenshot(page, 2, '03-record');
  await expectAccessible(page, 'a record page');
  await page.locator('[data-check]').first().scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 200);
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

  await page.goto(`/p/${projectId}`);
  await expect(page.getByRole('main').locator('[data-record="FDR-INT-001"] [data-stage]')).toHaveAttribute('data-stage', 'ready');
  await screenshot(page, 2, '05-overview-one-ready');
});
