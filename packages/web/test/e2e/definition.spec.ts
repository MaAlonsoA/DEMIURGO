// The product definition after Day 1 (docs/superpowers/plans/2026-09-28-definicion-del-producto.md),
// end to end with the simulated provider. The idea answers six of the eight questions of the product
// definition stage ([infer] makes the simulation read them in its first sentence) and leaves two
// open; the person corrects one, answers one in Spanish, leaves one open and confirms it all at once;
// the system drafts the definition, in English, with the person's own words beside it; the person
// approves it on the Product page, where each section says where it comes from; the next thread's run
// reads it whole; changing a section proposes the change with its why; and a decision in another
// thread changes it in one step.

import type { Page } from '@playwright/test';
import { type PersonApi, expect, expectAccessible, test } from './support/fixtures.ts';

const SENTENCE = 'Members sign up for club trips and organizers see who is coming.';
const IDEA = `${SENTENCE} They pay at the door. [infer]`;
const SPANISH = 'Los pagos dentro de la aplicación quedan fuera.';
const OFFLINE = 'It also works offline, as an installed app.';

type Run = { id: string; state: string };
type RunDetail = {
  context_pack: {
    dependencies: { type: string; id: string; version: number | null }[];
    content: { product_definition?: { code: string; version: number; sections: unknown[] } };
  };
};
type Definition = { record: { id: string; code: string } | null };

function runsSettled(person: PersonApi, projectId: string, explorationId: string) {
  return person.until<Run[]>(
    `/api/projects/${projectId}/runs?exploration=${explorationId}`,
    (runs) => runs.length >= 1 && runs.every((r) => !['queued', 'running'].includes(r.state)),
    45_000,
  );
}

const item = (page: Page, section: string) =>
  page.locator('[data-definition-answers] > li').filter({ has: page.getByRole('heading', { name: section, exact: true }) });

const section = (page: Page, key: string) => page.locator(`[data-definition-section="${key}"]`).first();

test('the idea leaves a product definition behind: read, confirmed at once, approved, read by the next thread and changed with its why', async ({
  page,
  person,
}) => {
  test.setTimeout(150_000);
  const projectId = await person.createProject('Club trips');
  const explorationId = (await person.command(projectId, 'exploration.open', { purpose: 'An app for our club trips' })).entity_id;
  await person.command(projectId, 'message.post', { exploration_id: explorationId, text: IDEA, respond: true });
  await runsSettled(person, projectId, explorationId);

  // Day 1: what DEMIURGO read in the idea, with the words it read it in, and what the idea doesn't say.
  await page.goto(`/p/${projectId}/start/${explorationId}`);
  const block = page.getByRole('region', { name: 'Your product definition, from your idea' });
  await expect(block).toBeVisible();
  await expect(block.locator('[data-answer-state="read"]')).toHaveCount(6);
  await expect(block.locator('[data-answer-state="asked"]')).toHaveCount(2);
  await expect(item(page, 'Purpose')).toContainText(SENTENCE);
  const confirm = block.getByRole('button', { name: 'Confirm and draft the definition' });
  await expect(confirm).toBeDisabled();
  await expect(block).toContainText('2 still to answer or leave open.');

  // The person corrects one reading, answers what is left out and leaves the constraints open.
  await item(page, 'Who uses it').getByRole('button', { name: 'Correct' }).click();
  await item(page, 'Who uses it').getByLabel('Your answer: Who uses it').fill('Club members, organizers and guests.');
  await item(page, 'What is left out').getByLabel('Your answer: What is left out').fill(SPANISH);
  await item(page, 'Constraints').getByRole('button', { name: 'Leave it open' }).click();
  await expectAccessible(page, 'Day 1 answers of the product definition');
  await confirm.click();

  // The Product page: the drafted definition waits for the person, each section with its source.
  await expect(page).toHaveURL(new RegExp(`/p/${projectId}$`));
  const drafted = page.locator('[data-definition-proposal]');
  await expect(drafted.getByRole('heading', { name: 'Your product definition, drafted from your answers' })).toBeVisible();
  await expect(drafted.locator('[data-definition-section]')).toHaveCount(8);
  await expect(drafted.locator('[data-definition-section="purpose"] [data-settled="assumed"]')).toBeVisible();
  await expect(drafted.locator('[data-definition-section="purpose"]')).toContainText(SENTENCE);
  await expect(drafted.locator('[data-definition-section="stakeholders"] [data-settled="corrected"]')).toBeVisible();
  await expect(drafted.locator('[data-definition-section="scope_out"] [data-settled="answered"]')).toBeVisible();
  // Records are kept in English: the simulated translator marks what it put into English.
  await expect(drafted.locator('[data-definition-section="scope_out"]')).toContainText(`[en] ${SPANISH}`);
  await expect(drafted.locator('[data-definition-section="scope_out"] [data-definition-own-words]')).toContainText(SPANISH);
  await expect(drafted.locator('[data-definition-section="constraints"]')).toContainText('Left open: Not decided yet.');
  await expectAccessible(page, 'Product page with the drafted definition');
  await drafted.getByRole('button', { name: 'Approve the definition' }).click();

  const document = page.locator('[data-definition-version="1"]');
  await expect(document).toBeVisible();
  await expect(page.locator('[data-definition-proposal]')).toHaveCount(0);
  await expect(section(page, 'stakeholders')).toContainText('Club members, organizers and guests.');
  const { record } = await person.get<Definition>(`/api/projects/${projectId}/definition`);
  expect(record?.code).toMatch(/^DEF-/);
  // One definition that keeps up to date: no version numbers outside its history.
  await expect(page.getByRole('region', { name: 'What the product is' })).toContainText('Approved by you');
  await expect(page.getByRole('region', { name: 'What the product is' })).not.toContainText('version 1');

  // The next thread's run reads the definition whole and depends on its version.
  const other = (await person.command(projectId, 'exploration.open', { purpose: 'Paying for trips' })).entity_id;
  await person.command(projectId, 'message.post', { exploration_id: other, text: 'How do members pay?', respond: true });
  const [run] = await runsSettled(person, projectId, other);
  const detail = await person.get<RunDetail>(`/api/projects/${projectId}/runs/${run?.id}`);
  expect(detail.context_pack.content.product_definition?.version).toBe(1);
  expect(detail.context_pack.content.product_definition?.sections).toHaveLength(8);
  expect(detail.context_pack.dependencies).toContainEqual({ type: 'record', id: record?.id, version: 1 });

  // Changing a section: its question reopens with the reason and takes the new answer; version 2 is proposed.
  await section(page, 'constraints').getByRole('button', { name: 'Change' }).click();
  await page.getByLabel('What it should say: Constraints').fill('A web app, used from the browser.');
  await page.getByLabel('Why it changes').fill('We decided it runs in the browser.');
  await page.getByRole('button', { name: 'Propose the change' }).click();
  const next = page.locator('[data-definition-proposal]');
  await expect(next.getByRole('heading', { name: 'A change is proposed' })).toBeVisible();
  await expect(next.locator('[data-definition-why]')).toContainText('We decided it runs in the browser.');
  await expect(next.locator('[data-definition-before]')).toContainText('Left open: Not decided yet.');
  await next.getByRole('button', { name: 'Approve the change' }).click();

  await expect(page.locator('[data-definition-version="2"]')).toBeVisible();
  await expect(page.getByRole('region', { name: 'What the product is' })).toContainText('Last changed, and approved by you');
  await page.getByRole('button', { name: 'Last change' }).click();
  await expect(page.locator('[data-definition-unchanged]')).toContainText('Purpose');
  await expect(section(page, 'constraints')).toContainText('A web app, used from the browser.');
  await expect(section(page, 'constraints').locator('[data-definition-why]')).toContainText('We decided it runs in the browser.');
  await page.getByRole('button', { name: 'Last change' }).click();

  // A decision in another thread: DEMIURGO proposes the change there; the Product page lists it, and
  // approving it updates the definition at once.
  const where = (await person.command(projectId, 'exploration.open', { purpose: 'Using it offline' })).entity_id;
  await person.command(projectId, 'message.post', { exploration_id: where, text: `${OFFLINE} [redefine]`, respond: true });
  await runsSettled(person, projectId, where);
  await page.reload();
  const decided = page.locator('[data-definition-changes]');
  await expect(decided.getByRole('heading', { name: 'Changes decided in threads' })).toBeVisible();
  await expect(decided.locator('[data-definition-thread-change="constraints"]')).toContainText(OFFLINE);
  await expect(decided.locator('[data-definition-before]')).toContainText('A web app, used from the browser.');
  await expectAccessible(page, 'Product page with a change decided in a thread');
  await decided.getByRole('button', { name: 'Approve the change' }).click();
  await expect(page.locator('[data-definition-changes]')).toHaveCount(0);
  await expect(page.locator('[data-definition-version="3"]')).toBeVisible();
  await expect(section(page, 'constraints')).toContainText(OFFLINE);
  await page.getByRole('button', { name: 'Last change' }).click();
  await expect(section(page, 'constraints')).toContainText('Changed after a thread');
  await expect(section(page, 'constraints').getByRole('link', { name: 'Open the thread' })).toHaveAttribute(
    'href',
    `/p/${projectId}/threads/${where}`,
  );
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.locator('[data-definition-history] li')).toHaveCount(3);
});
