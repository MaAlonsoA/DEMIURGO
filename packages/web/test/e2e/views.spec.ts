// Product views (FDR-INT-002): the map of the ratified design/ (lanes by area, relations from the
// links, the panel of a selection, zoom by buttons and keys, Esc to clear, a legend that is always
// there) and the journeys of a feature (steps, paths and the gaps that wait on the person).

import type { ProductJourneys } from '../../src/api/views.ts';
import { ratifiedProject } from './record-setup.ts';
import { expect, expectAccessible, screenshot, test } from './support/fixtures.ts';

test('AC-INT-002-01 AC-INT-002-02 AC-INT-002-03 AC-INT-002-04 the map shows each record in its area with the relations its links declare, and a selection keeps its panel across zoom', async ({
  page,
  person,
}) => {
  const projectId = await ratifiedProject(person, 'Map of DEMIURGO');
  await page.goto(`/p/${projectId}`);
  await page.getByRole('navigation', { name: 'Product views' }).getByRole('link', { name: 'Map' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${projectId}/map$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Map' })).toBeVisible();

  const lane = page.getByRole('region', { name: 'Area: plataforma' });
  await expect(lane).toBeVisible();
  const feature = page.locator('[data-map-node="FDR-AGE-002"]');
  await expect(feature).toBeVisible();
  await expect(page.locator('[data-map-lines] path[data-relation="follows"]').first()).toBeAttached();

  // The legend is always there, and names every line style, "under review" included.
  const legend = page.getByRole('region', { name: 'How to read the map' });
  for (const style of ['Needs another feature', 'Follows a rule', 'Conflicts', 'Affects (derived from)', 'Under review'])
    await expect(legend).toContainText(style);

  // Selecting it shows where it comes from and the rules it follows; the legend stays.
  await feature.click();
  await expect(feature).toHaveAttribute('aria-pressed', 'true');
  const panel = page.locator('[data-map-panel]');
  await expect(panel).toContainText('Agentes y proveedores');
  await expect(panel.getByRole('heading', { name: 'Rules it follows' })).toBeVisible();
  await expect(panel.getByRole('link', { name: /ADR-AGE-001/ })).toBeVisible();
  await expect(legend).toBeVisible();
  // Nothing is dimmed to show the selection: axe checks the whole page.
  await expectAccessible(page, 'the map with a selection');
  await screenshot(page, 10, 'map');

  // Zoom keeps the selection, by buttons and by keys.
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect(page.locator('[data-map-scale]')).toHaveAttribute('data-map-scale', '0.9');
  await page.getByRole('button', { name: 'Fit' }).click();
  await expect(feature).toHaveAttribute('aria-pressed', 'true');
  await expect(panel).toBeVisible();
  await feature.focus();
  await page.keyboard.press('0');
  await expect(page.locator('[data-map-scale]')).toHaveAttribute('data-map-scale', '1');
  await page.keyboard.press('-');
  await expect(page.locator('[data-map-scale]')).toHaveAttribute('data-map-scale', '0.9');
  await page.keyboard.press('+');
  await expect(page.locator('[data-map-scale]')).toHaveAttribute('data-map-scale', '1');
  await expect(feature).toHaveAttribute('aria-pressed', 'true');

  // With the keyboard: another element is selected with Enter, and Esc clears the selection.
  const other = page.locator('[data-map-node="ADR-AGE-001"]');
  await other.focus();
  await page.keyboard.press('Enter');
  await expect(other).toHaveAttribute('aria-pressed', 'true');
  await expect(panel).toContainText('Agentes por CLI con suscripción');
  await page.keyboard.press('Escape');
  await expect(other).toHaveAttribute('aria-pressed', 'false');
  await expect(panel).toHaveCount(0);
  await expect(legend).toBeVisible();
});

test('AC-INT-002-05 AC-INT-002-06 AC-INT-002-07 a journey shows its steps, its paths from the checks and the gaps that wait on the person', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Club journeys');
  const thread = (await person.command(projectId, 'exploration.open', { purpose: 'Sign-ups' })).entity_id;
  await person.command(projectId, 'question.raise', {
    exploration_id: thread,
    question: 'Is there a limit on places per activity?',
  });
  await person.command(projectId, 'record.create', {
    type: 'fdr',
    domain: 'signups',
    title: 'Sign up for an activity',
    sections: [
      { title: 'Goal', content: 'A member takes a place in one step.' },
      { title: 'Scope', content: 'Signing up.' },
      { title: 'Out of scope', content: 'Paying.' },
      {
        title: 'Behavior',
        content:
          '1. **See activities.** Published ones, with their date.\n2. **Open one.** Its details.\n3. **Sign up.** One tap.',
      },
    ],
    criteria: [
      {
        carry: 'new',
        title: 'Only members',
        statement: 'Given someone who is not a member, when they sign up, then they see "Only members can sign up".',
        verification: 'automatic',
        check: 'A test signs up without being a member.',
      },
      {
        carry: 'new',
        title: 'Once',
        statement: 'Given a member already signed up, when they sign up again, then no second place is taken.',
        verification: 'automatic',
        check: 'A test signs up twice.',
      },
    ],
    origin: { type: 'exploration', id: thread },
  });

  // Every open question of its thread is a gap: the one raised here and, since v2.1, the questions of
  // the design stage the thread opened with. The count is the API's.
  const { journeys } = await person.get<ProductJourneys>(`/api/projects/${projectId}/journeys`);
  const gaps = journeys.find((j) => j.title === 'Sign up for an activity')?.gaps.length ?? 0;
  expect(gaps).toBeGreaterThanOrEqual(1);

  await page.goto(`/p/${projectId}/journeys`);
  await expect(page.getByRole('heading', { level: 1, name: 'Journeys' })).toBeVisible();
  // The journeys are a single-select listbox: the shown one is the selected option.
  const list = page.getByRole('listbox', { name: 'Journeys' });
  const option = list.getByRole('option', { name: /Sign up for an activity/ });
  await expect(option).toContainText(gaps === 1 ? '1 path waits on you' : `${gaps} paths wait on you`);
  await expect(option).toHaveAttribute('aria-selected', 'true');
  const journey = page.locator('[data-journey]');
  await expect(journey.getByRole('heading', { level: 2, name: 'Sign up for an activity' })).toBeVisible();
  await expect(journey.locator('[data-step]')).toHaveCount(3);
  await expect(journey.locator('[data-step="1"]')).toContainText('See activities.');
  await expect(journey.locator('[data-path]')).toHaveCount(2);
  await expect(journey.locator('[data-path]').first()).toContainText('If someone who is not a member');
  await expect(journey.locator('[data-gap]')).toHaveCount(gaps);
  const gap = journey.locator('[data-gap]').filter({ hasText: 'Is there a limit on places per activity?' });
  await expect(gap).toContainText('Not defined yet');
  await expect(gap.getByRole('link', { name: /^Answer/ })).toHaveAttribute('href', `/p/${projectId}/threads/${thread}`);
  await expect(page.locator('[data-journey-summary]')).toContainText('waiting on you');
  await expectAccessible(page, 'a journey with a gap');
  await screenshot(page, 10, 'journeys');
});
