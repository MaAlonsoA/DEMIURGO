// A project is renamed from its project switcher (DESIGN.md §2.1: renaming lives with the project,
// not in the person's menu): the new name shows at once, there and in the project list. The list
// says when it can't load, and never that there are no projects (DESIGN.md §3.9, §5).

import { expect, expectAccessible, test } from './support/fixtures.ts';

test('a project is renamed from the project switcher and the new name shows without reloading', async ({ page, person }) => {
  const projectId = await person.createProject('Club Activities');
  await person.createProject('Another one');
  await page.goto(`/p/${projectId}`);
  await page.getByRole('button', { name: /^Project: Club Activities/ }).click();
  await page.getByRole('menuitem', { name: 'Rename the project…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename the project' });
  await expect(dialog.getByLabel('Name')).toHaveValue('Club Activities');
  await expectAccessible(page, 'renaming a project');
  await dialog.getByLabel('Name').fill('Club Life');
  await dialog.getByRole('button', { name: 'Rename' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: /^Project: Club Life/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Club Life' })).toBeVisible();

  await page.getByRole('button', { name: /^Project: Club Life/ }).click();
  await page.getByRole('menuitem', { name: 'All projects' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  const list = page.getByRole('list', { name: 'Projects' });
  await expect(list.getByRole('link', { name: /Club Life/ })).toBeVisible();
  // Each project says its state in words.
  await expect(list.locator(`[data-project="${projectId}"] [data-status]`)).toHaveText('Active');
  await expectAccessible(page, 'Your projects');
  const events = await person.get<{ command: string; actor: string }[]>(`/api/projects/${projectId}/events?from=0`);
  expect(events.filter((e) => e.command === 'project.rename').map((e) => e.actor)).toEqual(['human:ana']);
});

test('the projects list says when it cannot load, with Retry, and never that there are no projects', async ({ page, person }) => {
  await person.createProject('Behind an error');
  let fail = true;
  await page.route('**/api/projects', (route) =>
    route.request().method() === 'GET' && fail ? route.fulfill({ status: 500, json: { error: 'down' } }) : route.fallback(),
  );
  await page.goto('/projects');
  const error = page.locator('[data-reasons]');
  await expect(error).toBeVisible({ timeout: 20_000 });
  await expect(error).toContainText('Something went wrong on our side. Nothing was changed.');
  await expect(page.getByText('There are no projects yet')).toHaveCount(0);
  await expectAccessible(page, 'Your projects, when the list fails');

  fail = false;
  await error.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('list', { name: 'Projects' }).getByRole('link', { name: /Behind an error/ })).toBeVisible();
});
