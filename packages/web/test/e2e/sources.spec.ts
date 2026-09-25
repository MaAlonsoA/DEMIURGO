// Sources (AC-INT-001-17): what the person and agents give DEMIURGO to read, with who registered it.
// An agent's source is untrusted input and the page says what that means in text; the full hash and
// the absolute time are readable without hovering; the success message stays until the next change.

import type { Source } from '../../src/api/types.ts';
import { expect, expectAccessible, screenshot, test } from './support/fixtures.ts';

test('AC-INT-001-17 the person registers a source from the UI and it appears in the list, with who registered it', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Sources');
  const agent = await person.agent(projectId, 'claude-code');
  await agent.command('source.register', {
    name: 'Notas de la reunión con el club',
    content: 'Los socios quieren apuntarse sin esperar a que nadie apruebe nada.',
  });

  await page.goto(`/p/${projectId}/sources`);
  await expect(page.getByRole('heading', { name: 'Sources', level: 1 })).toBeVisible();
  const table = page.getByRole('table', { name: 'Sources' });
  const fromAgent = table.getByRole('row', { name: /Notas de la reunión con el club/ });
  await expect(fromAgent).toContainText('Agent · claude-code');
  await expect(fromAgent).toContainText('Untrusted input');
  // What "untrusted input" means is written on the page, not only in a tooltip.
  await expect(page.getByText(/An agent registered it\. DEMIURGO reads it as input to check/)).toBeVisible();
  // The full hash is one click away, as text.
  const stored = await person.get<Source[]>(`/api/projects/${projectId}/sources`);
  const notes = stored.find((s) => s.name === 'Notas de la reunión con el club');
  await fromAgent.locator('summary').click();
  await expect(fromAgent).toContainText(notes?.content_hash ?? '-');
  await expectAccessible(page, 'Sources');

  // The form comes from the command's schema: a name and the content.
  const form = page.getByRole('form', { name: 'Add a source' });
  const add = form.getByRole('button', { name: 'Add a source' });
  await expect(add).toBeDisabled();
  await form.getByLabel('Name').fill('Reglamento del club');
  await form.getByLabel('Content').fill('Solo los socios pueden apuntarse a las actividades.');
  await add.click();
  const mine = table.getByRole('row', { name: /Reglamento del club/ });
  await expect(mine).toBeVisible();
  await expect(mine).toContainText('You');
  await expect(mine).not.toContainText('Untrusted input');
  await expect(form.getByLabel('Name')).toHaveValue('');
  // The confirmation stays (no 5 s timeout) until the person writes again.
  await expect(form).toContainText('Added “Reglamento del club”.');
  await page.waitForTimeout(5_500);
  await expect(form).toContainText('Added “Reglamento del club”.');
  await form.getByLabel('Name').fill('Otra');
  await expect(form).not.toContainText('Added “Reglamento del club”.');
  const after = await person.get<Source[]>(`/api/projects/${projectId}/sources`);
  const registered = after.find((s) => s.name === 'Reglamento del club');
  expect(registered?.registered_by).toBe('human:ana');
  await expect(mine).toContainText(registered?.content_hash.slice(0, 12) ?? '-');
});

test('screens of cut 7: sources', async ({ page, person }) => {
  const projectId = await person.createProject('DEMIURGO');
  const agent = await person.agent(projectId, 'claude-code');
  await agent.command('source.register', {
    name: 'Notas de la reunión con el club',
    content: 'Los socios quieren apuntarse sin esperar a que nadie apruebe nada.',
  });
  await person.command(projectId, 'source.register', {
    name: 'Reglamento del club',
    content: 'Solo los socios pueden apuntarse a las actividades.',
  });
  await agent.command('source.register', {
    name: 'Encuesta a organizadores (septiembre)',
    content: 'Los organizadores publican una actividad por semana de media.',
  });
  await page.goto(`/p/${projectId}/sources`);
  await expect(page.getByRole('table', { name: 'Sources' }).getByRole('row')).toHaveCount(4);
  await screenshot(page, 7, '27-sources');
});
