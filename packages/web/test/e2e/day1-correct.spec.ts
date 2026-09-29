// Correcting an answer on Day 1, end to end with the simulated provider: a correction is saved (it
// stays after a reload and waits to be confirmed with the others) or discarded, and "Talk it
// through" opens Go deeper over Day 1, where a reply of DEMIURGO can become the answer.

import type { Page } from '@playwright/test';
import { type PersonApi, expect, expectAccessible, test } from './support/fixtures.ts';

const IDEA = 'Members sign up for club trips and organizers see who is coming. They pay at the door. [infer]';
const CORRECTED = 'Club members, organizers and guests.';

type Run = { id: string; state: string };

function runsSettled(person: PersonApi, projectId: string, explorationId: string, count = 1) {
  return person.until<Run[]>(
    `/api/projects/${projectId}/runs?exploration=${explorationId}`,
    (runs) => runs.length >= count && runs.every((r) => !['queued', 'running'].includes(r.state)),
    45_000,
  );
}

const item = (page: Page, section: string) =>
  page.locator('[data-definition-answers] > li').filter({ has: page.getByRole('heading', { name: section, exact: true }) });

test('Day 1: a correction is saved or discarded, and "Talk it through" settles an answer from Go deeper', async ({
  page,
  person,
}) => {
  test.setTimeout(120_000);
  const projectId = await person.createProject('Club trips');
  const explorationId = (await person.command(projectId, 'exploration.open', { purpose: 'An app for our club trips' })).entity_id;
  await person.command(projectId, 'message.post', { exploration_id: explorationId, text: IDEA, respond: true });
  await runsSettled(person, projectId, explorationId);

  await page.goto(`/p/${projectId}/start/${explorationId}`);
  const block = page.getByRole('region', { name: 'Your product definition, from your idea' });
  await expect(block.locator('[data-answer-state="read"]')).toHaveCount(6);

  // Saved: the correction shows as the answer, waits for the others and stays after a reload.
  const users = item(page, 'Who uses it');
  const read = (await users.locator('[data-answer-text]').textContent()) ?? '';
  await users.getByRole('button', { name: 'Correct' }).click();
  // Correcting a reading offers the question's options too.
  await expect(users.getByRole('group').getByRole('button').first()).toBeVisible();
  await users.getByLabel('Your answer: Who uses it').fill(CORRECTED);
  await users.getByRole('button', { name: 'Save' }).click();
  await expect(users).toHaveAttribute('data-answer-state', 'corrected');
  await expect(users.locator('[data-answer-text]')).toHaveText(CORRECTED);
  await expect(users).toContainText('Saved. It is confirmed with the others.');
  await page.reload();
  await expect(users.locator('[data-answer-text]')).toHaveText(CORRECTED);

  // Discarded: what DEMIURGO read comes back.
  await users.getByRole('button', { name: 'Correct' }).click();
  await users.getByLabel('Your answer: Who uses it').fill('Something else.');
  await users.getByRole('button', { name: 'Discard' }).click();
  await expect(users.locator('[data-answer-text]')).toHaveText(CORRECTED);
  await users.getByRole('button', { name: 'Back to what I read' }).click();
  await expect(users).toHaveAttribute('data-answer-state', 'read');
  await expect(users.locator('[data-answer-text]')).toHaveText(read);

  // Talk it through: Go deeper over Day 1; DEMIURGO's reply becomes the answer.
  const principles = item(page, 'Principles');
  const asked = (await principles.getAttribute('data-question')) ?? '';
  await principles.getByRole('button', { name: 'Talk it through' }).click();
  const deeper = page.locator(`[data-deeper="${asked}"]`);
  await expect(deeper).toBeVisible();
  // The options are there from the start; hiding them leaves the room to the conversation, and the
  // panel can be widened.
  await expect(deeper.getByRole('radio').first()).toBeVisible();
  await expect(deeper.getByRole('button', { name: 'Use as answer', exact: true })).toBeVisible();
  const sheet = page.getByRole('dialog', { name: 'Go deeper' });
  const narrow = (await sheet.boundingBox())?.width ?? 0;
  expect(narrow).toBeGreaterThan(600);
  await sheet.getByRole('separator', { name: 'Resize Go deeper' }).press('Shift+ArrowLeft');
  await expect.poll(async () => (await sheet.boundingBox())?.width ?? 0).toBeGreaterThan(narrow + 90);
  await deeper.getByRole('button', { name: 'Hide the options' }).click();
  await expect(deeper.getByRole('radio')).toHaveCount(0);
  await deeper.getByRole('button', { name: 'Show the options' }).click();
  await expect(deeper.getByRole('radio').first()).toBeVisible();
  await deeper.getByLabel('Talk it through').fill('Should speed come before safety?');
  await deeper.getByRole('button', { name: 'Send' }).click();
  // DEMIURGO words the idea the conversation arrived at: under its reply, and as one more option.
  const TALKED = 'From our talk: Should speed come before safety?';
  const idea = deeper.locator('[data-conversation-option]');
  await expect(idea).toContainText(TALKED, { timeout: 45_000 });
  await expect(
    deeper.getByRole('radio', { name: new RegExp(`From the conversation.*${TALKED.replace('?', '\\?')}`) }),
  ).toBeVisible();
  await expectAccessible(page, 'Go deeper over Day 1');
  await idea.getByRole('button', { name: 'Use this idea as the answer' }).click();
  await deeper.getByRole('button', { name: 'Use as answer' }).click();
  await expect(deeper).toHaveCount(0);
  await expect(principles).toHaveAttribute('data-answer-state', 'corrected');
  await expect(principles.locator('[data-answer-text]')).toHaveText(TALKED);
  // On Day 1 too, correcting offers the idea beside the other options.
  await principles.getByRole('button', { name: 'Correct' }).click();
  await expect(principles.locator('[data-conversation-option]')).toContainText(TALKED);
  await expect(principles.locator('[data-conversation-option]')).toHaveAttribute('aria-pressed', 'true');
  // Talking doesn't read the idea again: the block keeps what DEMIURGO read.
  await expect(block.locator('[data-answer-state="read"]')).toHaveCount(5);
});
