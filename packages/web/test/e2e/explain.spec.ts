// "Explain it simply", end to end with the simulated provider: on Day 1 the explanation of a
// question shows under it, without becoming a new reading of the idea; in a thread, the button on a
// question opens Go deeper with the request and the explanation.

import type { Page } from '@playwright/test';
import { type PersonApi, expect, expectAccessible, test } from './support/fixtures.ts';

const IDEA = 'Members sign up for club trips and organizers see who is coming. They pay at the door. [infer]';
const REQUEST = 'Explain this question to me more simply';

type Run = { id: string; state: string; agent?: string | null };

function runsSettled(person: PersonApi, projectId: string, explorationId: string, count = 1) {
  return person.until<Run[]>(
    `/api/projects/${projectId}/runs?exploration=${explorationId}`,
    (runs) => runs.length >= count && runs.every((r) => !['queued', 'running'].includes(r.state)),
    45_000,
  );
}

const item = (page: Page, section: string) =>
  page.locator('[data-definition-answers] > li').filter({ has: page.getByRole('heading', { name: section, exact: true }) });

test('explain it simply: under the question on Day 1, and in Go deeper in a thread', async ({ page, person }) => {
  test.setTimeout(120_000);
  const projectId = await person.createProject('Club trips');
  const explorationId = (await person.command(projectId, 'exploration.open', { purpose: 'An app for our club trips' })).entity_id;
  await person.command(projectId, 'message.post', { exploration_id: explorationId, text: IDEA, respond: true });
  await runsSettled(person, projectId, explorationId);

  // Day 1: the person doesn't know what to answer about the principles.
  await page.goto(`/p/${projectId}/start/${explorationId}`);
  const block = page.getByRole('region', { name: 'Your product definition, from your idea' });
  await expect(block.locator('[data-answer-state="read"]')).toHaveCount(6);
  const principles = item(page, 'Principles');
  await principles.getByRole('button', { name: /^Explain it simply/ }).click();
  const explanation = principles.locator('[data-explanation]');
  await expect(explanation).toContainText('Explained simply');
  await expect(explanation.locator('.md-prose')).toContainText(REQUEST, { timeout: 45_000 });
  const runs = await runsSettled(person, projectId, explorationId, 2);
  expect(runs.filter((r) => r.agent === 'explainer')).toHaveLength(1);
  // Explaining is not a new reading of the idea: the block keeps what DEMIURGO read.
  await expect(block.locator('[data-answer-state="read"]')).toHaveCount(6);
  await expectAccessible(page, 'Day 1 with a question explained');
  await principles.getByRole('button', { name: 'Hide the explanation' }).click();
  await expect(explanation.locator('.md-prose')).toHaveCount(0);
  await principles.getByRole('button', { name: 'Show the explanation' }).click();
  await expect(explanation.locator('.md-prose')).toContainText(REQUEST);

  // In the thread, the button on a question opens Go deeper with the request and the explanation.
  await page.goto(`/p/${projectId}/threads/${explorationId}`);
  const card = page.locator('article[data-question]').first();
  const asked = (await card.getAttribute('data-question')) ?? '';
  await card.getByRole('button', { name: /^Explain it simply/ }).click();
  const deeper = page.locator(`[data-deeper="${asked}"]`);
  await expect(deeper).toBeVisible();
  await expect(deeper).toContainText(REQUEST);
  await expect(deeper.locator('.md-prose')).toContainText('Got it', { timeout: 45_000 });
  await expectAccessible(page, 'Go deeper with a question explained');
});
