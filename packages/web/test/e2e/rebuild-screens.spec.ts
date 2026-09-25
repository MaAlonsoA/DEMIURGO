// Screens of the rebuilt frontend (docs/ux-rebuild/SUMMARY.md): every main screen at 1440 × 900 in
// the light theme, a few in the dark theme and at phone width, each checked with axe. The data is
// seeded through the API with the simulated engine (never the live instance's data):
// - the repository's design/, ratified;
// - a decision and a feature approved;
// - threads with DEMIURGO's answers, a run that is still working, a failed one and an invalid one;
// - a source and an agent key.
// The screenshots go to docs/ux-rebuild/screenshots/.

import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import type { ProductState, RunListItem } from '../../src/api/types.ts';
import { ratifiedProject, settled } from './record-setup.ts';
import { type PersonApi, anonymousContext, expect, expectAccessible, test } from './support/fixtures.ts';

const OUT = fileURLToPath(new URL('../../../../docs/ux-rebuild/screenshots/', import.meta.url));

const finished = (r: RunListItem) => !['queued', 'running'].includes(r.state);

async function threadWith(person: PersonApi, projectId: string, purpose: string, text: string): Promise<string> {
  const t = await person.command(projectId, 'exploration.open', { purpose });
  await person.command(projectId, 'message.post', { exploration_id: t.entity_id, text, respond: true });
  return t.entity_id;
}

async function runsOf(person: PersonApi, projectId: string, thread: string, done: (r: RunListItem[]) => boolean) {
  return person.until<RunListItem[]>(`/api/projects/${projectId}/runs?exploration=${thread}`, done, 60_000);
}

async function shoot(page: Page, name: string, path: string, options: { axe?: boolean } = {}): Promise<void> {
  await page.goto(path);
  await expect(page.locator('#page-title')).toBeVisible({ timeout: 20_000 });
  // Skeletons and live data settle.
  await page.waitForTimeout(1200);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: false });
  if (options.axe !== false) await expectAccessible(page, name);
}

test('screens of the rebuild: every main screen, in light, dark and at phone width', async ({ page, person, browser }) => {
  test.setTimeout(600_000);
  const projectId = await ratifiedProject(person, 'DEMIURGO');
  await settled(person, projectId);

  // A decision and a feature approved, so the product shows confirmed and ready things too.
  const state = await person.get<ProductState>(`/api/projects/${projectId}/state`);
  const decision = state.decisions[0];
  const feature = state.designs.find((d) => d.type === 'fdr');
  if (decision) await person.command(projectId, 'record_version.approve', {}, decision.latest_id);
  if (feature) await person.command(projectId, 'record_version.approve', {}, feature.latest_id).catch(() => undefined);
  await settled(person, projectId);

  // Threads: one answered, one still working, one failed and one with an invalid output.
  const talk = await threadWith(person, projectId, 'Guests at activities', 'Can members bring guests to open activities?');
  await runsOf(person, projectId, talk, (r) => r.length > 0 && r.every(finished));
  const failing = await threadWith(person, projectId, 'The evidence format', '[fail-once] Which fields does evidence need?');
  const [failed] = await runsOf(person, projectId, failing, (r) => r.length > 0 && r.every(finished));
  await threadWith(person, projectId, 'Explore the [invalid] output', 'Answer anything.');
  await threadWith(person, projectId, 'Pricing tiers', '[slow] Think about pricing before answering.');
  await person.command(projectId, 'source.register', {
    name: 'Interview notes, 12 Sep',
    content: 'Organizers want a weekly summary. Members forget to confirm their places.',
  });
  await person.command(projectId, 'agent_token.issue', { name: 'claude-code' });
  const inbox = await person.get<{ batches: { id: string }[] }>(`/api/projects/${projectId}/inbox`);

  await page.setViewportSize({ width: 1440, height: 900 });
  await shoot(page, '01-needs-you', `/p/${projectId}/needs-you`);
  await shoot(page, '02-catch-up', `/p/${projectId}/needs-you?catch-up=1`);
  if (inbox.batches[0]) await shoot(page, '03-batch', `/p/${projectId}/batches/${inbox.batches[0].id}`);
  await shoot(page, '04-threads', `/p/${projectId}/threads`);
  await shoot(page, '05-thread', `/p/${projectId}/threads/${talk}`);
  await shoot(page, '06-activity', `/p/${projectId}/activity`);
  if (failed) await shoot(page, '07-run', `/p/${projectId}/runs/${failed.id}`);
  await shoot(page, '08-overview', `/p/${projectId}`);
  if (feature) await shoot(page, '09-record', `/p/${projectId}/records/${feature.code}`);
  if (feature) await shoot(page, '10-record-questions', `/p/${projectId}/records/${feature.code}?tab=questions`);
  await shoot(page, '11-map', `/p/${projectId}/map`);
  await shoot(page, '12-journeys', `/p/${projectId}/journeys`);
  await shoot(page, '13-origins', `/p/${projectId}/origins`);
  await shoot(page, '14-knowledge', `/p/${projectId}/knowledge`);
  await shoot(page, '15-sources', `/p/${projectId}/sources`);
  await shoot(page, '16-models', `/p/${projectId}/models`);
  await shoot(page, '17-agent-keys', `/p/${projectId}/agent-keys`);
  await shoot(page, '18-new-record', `/p/${projectId}/records/new?type=fdr`);
  if (feature) await shoot(page, '19-new-version', `/p/${projectId}/records/${feature.code}/new-version`);
  await shoot(page, '20-projects', '/projects');
  await shoot(page, '21-new-project', '/new');

  // The command menu and Help, over the overview.
  await page.goto(`/p/${projectId}`);
  await expect(page.locator('#page-title')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search decisions, features, ideas' }).fill('agent');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}22-command-menu.png` });
  await expectAccessible(page, 'the command menu');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Help' }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}23-help.png` });
  await expectAccessible(page, 'Help');
  await page.keyboard.press('Escape');

  // Dark theme: the same tokens, their dark values.
  await page.evaluate(() => localStorage.setItem('dm-theme', 'dark'));
  await shoot(page, '30-dark-needs-you', `/p/${projectId}/needs-you`);
  await shoot(page, '31-dark-thread', `/p/${projectId}/threads/${talk}`);
  if (feature) await shoot(page, '32-dark-record', `/p/${projectId}/records/${feature.code}`);
  await page.evaluate(() => localStorage.removeItem('dm-theme'));

  // Phone width: the sidebar becomes a drawer and the columns stack.
  await page.setViewportSize({ width: 390, height: 844 });
  await shoot(page, '40-phone-needs-you', `/p/${projectId}/needs-you`);
  await shoot(page, '41-phone-thread', `/p/${projectId}/threads/${talk}`);
  await shoot(page, '42-phone-overview', `/p/${projectId}`);

  // Sign in, outside any session.
  const anonymous = await anonymousContext(browser);
  const signIn = await anonymous.newPage();
  await signIn.goto('/sign-in');
  await expect(signIn.getByRole('heading', { level: 1 })).toBeVisible();
  await signIn.screenshot({ path: `${OUT}00-sign-in.png` });
  await expectAccessible(signIn, 'Sign in');
  await anonymous.close();
});
