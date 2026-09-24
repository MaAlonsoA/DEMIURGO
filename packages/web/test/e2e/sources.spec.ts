import type { Source } from '../../src/api/types.ts';
import { foldLegend } from './knowledge-data.ts';
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
  await expect(fromAgent.getByRole('img', { name: 'Agent · claude-code' })).toBeVisible();
  await expect(fromAgent).toContainText('Untrusted input');
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
  await expect(mine.getByRole('img', { name: 'You' })).toBeVisible();
  await expect(mine).not.toContainText('Untrusted input');
  await expect(form.getByLabel('Name')).toHaveValue('');
  const stored = await person.get<Source[]>(`/api/projects/${projectId}/sources`);
  const registered = stored.find((s) => s.name === 'Reglamento del club');
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
  await foldLegend(page);
  await screenshot(page, 7, '27-sources');
});
