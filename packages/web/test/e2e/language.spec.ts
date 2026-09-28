// The person reads DEMIURGO in their language (plan contenido-en-ingles): with a Spanish browser and
// no choice of their own, the interface speaks Spanish and a record written in English shows a
// marked reading translation, one click away from the original, which is what stays stored. The
// person's own choice isn't touched: every walk shares the same person.

import { expect, expectAccessible, test } from './support/fixtures.ts';

test.use({ locale: 'es-ES' });

test('with a Spanish browser, the interface is in Spanish and an English record reads translated, marked, with its original one click away', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Idioma');
  const purpose = 'The person can revoke the token of an external agent at any time.';
  const thread = await person.command(projectId, 'exploration.open', { purpose });

  await page.goto(`/p/${projectId}/threads/${thread.entity_id}`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('navigation', { name: 'Secciones' })).toBeVisible();
  // The simulated translator marks what it translated with the language.
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`[es] ${purpose}`);
  await expect(page.getByText('Traducido', { exact: true }).first()).toBeVisible();
  await expectAccessible(page, 'Hilo en español');

  await page.getByRole('button', { name: 'Ver el original' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(purpose);

  // What is stored stays in English.
  const detail = await person.get<{ purpose: string }>(`/api/projects/${projectId}/explorations/${thread.entity_id}`);
  expect(detail.purpose).toBe(purpose);
});
