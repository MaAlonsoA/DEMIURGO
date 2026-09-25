// Models & providers (FDR-AGE-002): the person sees what each provider offers, chooses which engine
// runs each part of DEMIURGO for this project, and a failed run can be retried on another engine.
// The e2e server only runs the simulated provider, with every agent assigned to it.

import type { Page } from '@playwright/test';
import { expect, expectAccessible, screenshot, test } from './support/fixtures.ts';

async function legendFolded(page: Page) {
  await page.addInitScript(() => localStorage.setItem('demiurgo:legend', JSON.stringify({ dismissed: true, seen: [] })));
}

test('AC-AGE-002-02 the person opens Models & providers from the menu, sees the providers and overrides an agent for the project', async ({
  page,
  person,
}) => {
  await legendFolded(page);
  const projectId = await person.createProject('Engines');
  await page.goto(`/p/${projectId}`);
  await page.getByRole('button', { name: /Signed in as/ }).click();
  await page.getByRole('menuitem', { name: 'Models & providers' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${projectId}/models$`));
  await expect(page.getByRole('heading', { name: 'Models & providers' })).toBeVisible();

  const simulated = page.locator('[data-provider="simulated"]');
  await expect(simulated).toContainText('Ready');
  await expect(simulated).toContainText('Simulated (deterministic)');

  const explorer = page.locator('[data-agent="explorer"]');
  await expect(explorer.locator('[data-effective]')).toContainText('(everywhere)');
  await explorer.getByRole('button', { name: 'Use another here' }).click();
  await expect(explorer.locator('[data-effective]')).toContainText('(this project)');
  await expect(explorer.getByRole('group', { name: /this project/ })).toBeVisible();
  await expectAccessible(page, 'Models & providers');
  await screenshot(page, 9, 'models-and-providers');

  await explorer.getByRole('button', { name: 'Use everywhere’s' }).click();
  await expect(explorer.locator('[data-effective]')).toContainText('(everywhere)');
});

test('AC-AGE-002-02 before any project, Models & providers is reachable from New project and from Your projects', async ({
  page,
  person,
}) => {
  await legendFolded(page);
  await person.createProject('Somewhere');
  await page.goto('/new');
  await page.getByRole('link', { name: 'Models & providers' }).click();
  await expect(page).toHaveURL(/\/models$/);
  await expect(page.getByRole('heading', { name: 'Models & providers' })).toBeVisible();
  await expect(page.locator('[data-provider="simulated"]')).toContainText('Ready');
  // Only the choice for everywhere: there is no project here.
  const onboarding = page.locator('[data-agent="onboarding"]');
  await expect(onboarding.locator('[data-effective]')).toContainText('(everywhere)');
  await expect(onboarding.getByRole('group', { name: /everywhere/ })).toBeVisible();
  await expect(onboarding.getByRole('button', { name: 'Use another here' })).toHaveCount(0);
  await expectAccessible(page, 'Models & providers of the workspace');

  await page.getByRole('link', { name: 'Your projects' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.getByRole('link', { name: 'Models & providers' }).click();
  await expect(page).toHaveURL(/\/models$/);
});

test('AC-AGE-002-11 a failed run offers Retry with… and runs again on the chosen engine', async ({ page, person }) => {
  await legendFolded(page);
  const projectId = await person.createProject('Retry with');
  const threadId = (await person.command(projectId, 'exploration.open', { purpose: 'Try another engine' })).entity_id;
  await page.goto(`/p/${projectId}/threads/${threadId}`);
  await page.getByLabel('Message').fill('[invalid] Answer outside the schema.');
  await page.getByRole('button', { name: 'Ask DEMIURGO' }).click();
  const failed = page.locator('[data-run-card="failed"]');
  await expect(failed).toBeVisible({ timeout: 30_000 });

  await failed.getByRole('button', { name: 'Retry with…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('group', { name: 'Retry with' })).toBeVisible();
  await expect(dialog.getByLabel('Retry with: provider')).toHaveValue('simulated');
  await expectAccessible(page, 'Retry with…');
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog).toBeHidden();
  const runs = await person.until<{ id: string; retry_of: string | null; state: string }[]>(
    `/api/projects/${projectId}/runs?exploration=${threadId}`,
    (r) => r.some((x) => x.retry_of !== null),
    30_000,
  );
  expect(runs.filter((r) => r.retry_of !== null)).toHaveLength(1);
});
