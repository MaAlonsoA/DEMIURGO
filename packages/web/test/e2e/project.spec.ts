// Renaming a project from the person's menu: the new name shows at once, there and in the project list.

import { expect, expectAccessible, test } from './support/fixtures.ts';

test('a project is renamed from the person menu and the new name shows without reloading', async ({ page, person }) => {
  const projectId = await person.createProject('Club Activities');
  await person.createProject('Another one');
  await page.goto(`/p/${projectId}`);
  await page.getByRole('button', { name: /Signed in as/ }).click();
  await page.getByRole('menuitem', { name: 'Rename the project…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename the project' });
  await expect(dialog.getByLabel('Name')).toHaveValue('Club Activities');
  await expectAccessible(page, 'renaming a project');
  await dialog.getByLabel('Name').fill('Club Life');
  await dialog.getByRole('button', { name: 'Rename' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('banner').getByText('Club Life', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Club Life' })).toBeVisible();

  await page.getByRole('link', { name: 'Switch' }).click();
  await expect(page.getByText('Club Life', { exact: true })).toBeVisible();
  const events = await person.get<{ command: string; actor: string }[]>(`/api/projects/${projectId}/events?from=0`);
  expect(events.filter((e) => e.command === 'project.rename').map((e) => e.actor)).toEqual(['human:ana']);
});
