// Agent keys (DESIGN.md §3.9): issued from the Settings of the sidebar, the secret shown only once
// with the MCP setup line and a Copy that says it copied, usable by an agent through the API,
// stopped at once when revoked — and the focus kept on the key's row after "I have saved it" and
// after revoking.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_URL, expect, expectAccessible, test } from './support/fixtures.ts';

test('an agent key is issued from the sidebar, shown once, works for the agent and stops working when revoked', async ({
  page,
  person,
  playwright,
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const projectId = await person.createProject('Keys');
  await page.goto(`/p/${projectId}`);
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Agent keys' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Agent keys' })).toBeVisible();
  await expect(page.getByText('No agent has a key yet.')).toBeVisible();

  await page.getByRole('button', { name: 'New key' }).click();
  await page.getByLabel('Name of the agent').fill('claude-code');
  await page.getByRole('button', { name: 'Create the key' }).click();
  const issued = page.getByRole('status', { name: 'The key of claude-code' });
  const token = (await issued.locator('[data-secret]').innerText()).trim();
  expect(token).toMatch(/^dmg_agent_/);
  await expect(issued).toContainText(`DEMIURGO_AGENT_TOKEN=${token}`);
  await expect(issued).toContainText(`DEMIURGO_PROJECT=${projectId}`);

  // Copy says it copied, and the key is on the clipboard.
  await issued.getByRole('button', { name: 'Copy the key' }).click();
  await expect(issued.getByRole('button', { name: 'Copied the key' })).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(token);
  await expectAccessible(page, 'a key just issued');
  const dir = process.env.E2E_SHOTS;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, 'agent-keys-issued.png'), fullPage: true });
  }

  // The agent reads the project with it.
  const agent = await playwright.request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  expect((await agent.get(`/api/projects/${projectId}/state`)).status()).toBe(200);

  // Once saved, the secret is nowhere on the page, not even after a reload; the focus stays on its key.
  await issued.getByRole('button', { name: 'I have saved it' }).click();
  const row = page.locator('[data-agent-key="claude-code"]');
  await expect(row).toBeFocused();
  await page.reload();
  await expect(row).toHaveAttribute('data-key-state', 'active');
  expect(await page.content()).not.toContain(token);

  await row.getByRole('button', { name: 'Revoke' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('What it already proposed stays as it is.');
  await confirm.getByRole('button', { name: 'Revoke' }).click();
  await expect(row).toHaveAttribute('data-key-state', 'revoked');
  await expect(row).toContainText('Revoked');
  await expect(row).toBeFocused();
  expect((await agent.get(`/api/projects/${projectId}/state`)).status()).toBe(401);
  await expectAccessible(page, 'a revoked key');
  if (dir) await page.screenshot({ path: join(dir, 'agent-keys-revoked.png'), fullPage: true });
  await agent.dispose();
});
