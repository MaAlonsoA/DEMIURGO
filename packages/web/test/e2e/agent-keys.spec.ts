// Agent keys: issued from the person's menu, the secret shown only once with the MCP setup line,
// usable by an agent through the API, and stopped at once when revoked.

import { BASE_URL, expect, expectAccessible, test } from './support/fixtures.ts';

test('an agent key is issued from the menu, shown once, works for the agent and stops working when revoked', async ({
  page,
  person,
  playwright,
}) => {
  const projectId = await person.createProject('Keys');
  await page.goto(`/p/${projectId}`);
  await page.getByRole('button', { name: /Signed in as/ }).click();
  await page.getByRole('menuitem', { name: 'Agent keys' }).click();
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
  await expectAccessible(page, 'a key just issued');

  // The agent reads the project with it.
  const agent = await playwright.request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  expect((await agent.get(`/api/projects/${projectId}/state`)).status()).toBe(200);

  // Once saved, the secret is nowhere on the page, not even after a reload.
  await issued.getByRole('button', { name: 'I have saved it' }).click();
  await page.reload();
  await expect(page.locator('[data-agent-key="claude-code"]')).toHaveAttribute('data-key-state', 'active');
  expect(await page.content()).not.toContain(token);

  await page.locator('[data-agent-key="claude-code"]').getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke' }).click();
  await expect(page.locator('[data-agent-key="claude-code"]')).toHaveAttribute('data-key-state', 'revoked');
  expect((await agent.get(`/api/projects/${projectId}/state`)).status()).toBe(401);
  await agent.dispose();
});
