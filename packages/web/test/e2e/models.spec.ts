// Models & providers (DESIGN.md §3.9; FDR-AGE-002): the person sees what each provider offers,
// chooses which engine runs each part of DEMIURGO for this project — each change said once it
// applies — and a failed run can be retried on another engine. The e2e server only runs the
// simulated provider, with every agent assigned to it.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, expectAccessible, screenshot, test } from './support/fixtures.ts';

/**
 * The transition stylesheet (D-017) still pins html and body to 1280 px; until it goes, the reflow
 * checks lift that pin to see how these screens themselves behave at a phone's width.
 */
async function withoutLegacyMinWidth(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'html, body { min-width: 0 !important; }';
      document.head.append(style);
    });
  });
}

/** A check screenshot for the rebuild's visual review, only when E2E_SHOTS names a folder. */
async function shot(page: Page, name: string) {
  const dir = process.env.E2E_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}

test('AC-AGE-002-02 the person opens Models & providers from the sidebar, sees the providers and overrides an agent for the project', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Engines');
  await page.goto(`/p/${projectId}`);
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Models & providers' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${projectId}/models$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Models & providers' })).toBeVisible();

  const simulated = page.locator('[data-provider="simulated"]');
  await expect(simulated).toContainText('Ready');
  await expect(simulated).toContainText('Simulated (deterministic)');

  const explorer = page.locator('[data-agent="explorer"]');
  // Its name comes with its id.
  await expect(explorer).toContainText(/explorer@/);
  await expect(explorer.locator('[data-effective]')).toContainText('(everywhere)');
  await explorer.getByRole('button', { name: 'Use another here' }).click();
  await expect(explorer.locator('[data-effective]')).toContainText('(this project)');
  await expect(explorer.getByRole('group', { name: /this project/ })).toBeVisible();
  // The change applied at once, and the row says so.
  await expect(explorer.locator('[data-changed]')).toContainText(/now uses .* in this project\./);
  await expectAccessible(page, 'Models & providers');
  await screenshot(page, 9, 'models-and-providers');
  await shot(page, 'models');

  await explorer.getByRole('button', { name: 'Use everywhere’s' }).click();
  await expect(explorer.locator('[data-effective]')).toContainText('(everywhere)');
  await expect(explorer.locator('[data-changed]')).toContainText('engine in this project again.');

  // On a phone the rows stack: nothing is clipped and the page doesn't scroll sideways.
  await withoutLegacyMinWidth(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const here = explorer.getByRole('button', { name: 'Use another here' });
  await here.scrollIntoViewIfNeeded();
  await expect(here).toBeInViewport();
  expect((await explorer.boundingBox())?.width ?? 0).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, 'models-390');
});

test('AC-AGE-002-02 before any project, Models & providers is reachable from New project and from Your projects', async ({
  page,
  person,
}) => {
  await person.createProject('Somewhere');
  await page.goto('/new');
  await page.getByRole('link', { name: 'Models & providers' }).first().click();
  await expect(page).toHaveURL(/\/models$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Models & providers' })).toBeVisible();
  await expect(page.locator('[data-provider="simulated"]')).toContainText('Ready');
  // Only the choice for everywhere: there is no project here.
  const onboarding = page.locator('[data-agent="onboarding"]');
  await expect(onboarding.locator('[data-effective]')).toContainText('(everywhere)');
  await expect(onboarding.getByRole('group', { name: /everywhere/ })).toBeVisible();
  await expect(onboarding.getByRole('button', { name: 'Use another here' })).toHaveCount(0);
  // The workspace frame keeps the way out: the person's menu with Sign out.
  await expect(page.getByRole('button', { name: /Signed in as/ })).toBeVisible();
  await expectAccessible(page, 'Models & providers of the workspace');
  await shot(page, 'models-workspace');

  await page.getByRole('link', { name: 'Your projects' }).first().click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.getByRole('link', { name: 'Models & providers' }).first().click();
  await expect(page).toHaveURL(/\/models$/);
});

test('AC-AGE-002-11 a failed run offers Retry with… and runs again on the chosen engine', async ({ page, person }) => {
  const projectId = await person.createProject('Retry with');
  const threadId = (await person.command(projectId, 'exploration.open', { purpose: 'Try another engine' })).entity_id;
  await page.goto(`/p/${projectId}/threads/${threadId}`);
  await page.getByLabel('Message').fill('[invalid] Answer outside the schema.');
  await page.getByRole('button', { name: 'Ask DEMIURGO' }).click();
  const failed = page.locator('[data-run-card="failed"]');
  await expect(failed).toBeVisible({ timeout: 30_000 });

  await failed.getByRole('button', { name: 'Retry with…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Retry with another engine' });
  await expect(dialog.getByRole('group', { name: 'Retry with' })).toBeVisible();
  await expect(dialog.getByLabel('Retry with: provider')).toHaveValue('simulated');
  await expectAccessible(page, 'Retry with…');
  await shot(page, 'retry-with');
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog).toBeHidden();
  const runs = await person.until<{ id: string; retry_of: string | null; state: string }[]>(
    `/api/projects/${projectId}/runs?exploration=${threadId}`,
    (r) => r.some((x) => x.retry_of !== null),
    30_000,
  );
  expect(runs.filter((r) => r.retry_of !== null)).toHaveLength(1);

  // The same from the run page: the retry opens the new attempt's page.
  const original = runs.find((r) => r.retry_of === null);
  await page.goto(`/p/${projectId}/runs/${original?.id}`);
  await page.getByRole('button', { name: 'Retry with…' }).click();
  const again = page.getByRole('dialog', { name: 'Retry with another engine' });
  await expect(again.getByLabel('Retry with: provider')).toHaveValue('simulated');
  await again.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page).not.toHaveURL(new RegExp(`/runs/${original?.id}$`));
  await expect(page.getByRole('complementary', { name: 'Details' }).locator('[aria-current="true"]')).toContainText('Attempt 2');
});
