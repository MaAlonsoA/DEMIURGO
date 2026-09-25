// "What changed" on the overview (DESIGN.md §3.5, INV-LENS-*): coming back after an agent changed
// things, "While you were away" tells each one as a link and the changed things are marked
// "Changed" — nothing is dimmed, so axe checks the whole page. The lens follows the stream, but
// never tells the person their own actions of this session.

import type { Page } from '@playwright/test';
import type { Changes, IdeaAssessment } from '../../src/api/types.ts';
import { ratifiedProject, recordOf, settled, shot } from './record-setup.ts';
import { type PersonApi, expect, expectAccessible, screenshot, test } from './support/fixtures.ts';

const VISITS = 'demiurgo:visits';

/** Opens the overview and waits until this browser remembers the visit (the last event seen). */
async function visit(page: Page, projectId: string): Promise<string> {
  await page.goto(`/p/${projectId}`);
  await expect(page.getByRole('main').getByRole('heading', { name: /^Features/ })).toBeVisible();
  const handle = await page.waitForFunction(
    ([key, id]) => {
      const all = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, { event: string }>;
      return all[id]?.event ?? null;
    },
    [VISITS, projectId] as const,
  );
  const seen = (await handle.jsonValue()) ?? '';
  // Leaving the app: the next visit starts from what was seen.
  await page.goto('about:blank');
  return seen;
}

type Away = { projectId: string; thread: string; batchId: string; since: string };

const decisionProposal = (title: string) => ({
  type: 'decision',
  payload: {
    title,
    context: 'Members ask to bring friends.',
    decision: 'Each member can bring two guests.',
    consequences: 'Places are counted with the guests.',
  },
});

/** A visit, then changes by an agent while the person is away: a message in a thread and a batch about FDR-INT-001. */
async function comingBack(page: Page, person: PersonApi, name: string): Promise<Away> {
  const projectId = await ratifiedProject(person, name);
  const thread = (await person.command(projectId, 'exploration.open', { purpose: 'Guests at activities' })).entity_id;
  await person.command(projectId, 'question.raise', {
    exploration_id: thread,
    question: 'How many guests per member?',
  });
  await settled(person, projectId);
  const since = await visit(page, projectId);

  const fdr = await recordOf(person, projectId, 'FDR-INT-001');
  const agent = await person.agent(projectId, 'claude-code');
  await agent.command('message.post', { exploration_id: thread, text: 'Two guests per member is common.' });
  const batch = await agent.command<{ batchId: string; proposals: string[] }>('batch.submit', {
    summary: 'Guests in the design flow',
    dependencies: [{ type: 'record', id: fdr.id, code: 'FDR-INT-001', version: 1 }],
    proposals: [
      { type: 'exploration', payload: { purpose: 'Guests in the design flow' } },
      decisionProposal('Two guests per member'),
    ],
  });
  const proposalIds = batch.result?.proposals ?? [];
  await person.until<IdeaAssessment[]>(
    `/api/projects/${projectId}/knowledge/idea-assessments`,
    (list) => proposalIds.every((id) => list.some((a) => a.proposal.id === id)),
    60_000,
  );
  return { projectId, thread, batchId: batch.result?.batchId ?? '', since };
}

test('AC-INT-001-16 after changes by an agent, the overview marks only what changed and While you were away has one line per thing, as a link', async ({
  page,
  person,
}) => {
  const { projectId, thread, batchId, since } = await comingBack(page, person, 'Coming back');
  const changes = page.waitForResponse((r) => r.url().includes(`/api/projects/${projectId}/changes?since=${since}`));
  await page.goto(`/p/${projectId}`);
  const body = (await (await changes).json()) as Changes;
  const summary = page.getByRole('region', { name: 'While you were away' });
  await expect(summary).toBeVisible();

  // One line per thing, in the order the API groups them.
  const lines = summary.locator('[data-id]');
  await expect(lines).toHaveCount(body.things.length);
  const keys = await lines.evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
  expect(keys).toEqual(body.things.map((t) => `${t.kind}:${t.key}`));
  const threadLine = summary.locator(`[data-id="exploration:${thread}"]`);
  await expect(threadLine).toContainText('Guests at activities');
  await expect(threadLine.locator('[data-who]')).toHaveAttribute('data-who', 'agent');
  // Each line leads to what changed (INVENTORY §2 #17).
  await expect(threadLine.getByRole('link', { name: /Guests at activities/ })).toHaveAttribute(
    'href',
    `/p/${projectId}/threads/${thread}`,
  );
  const batchLine = summary.locator(`[data-id="batch:${batchId}"]`);
  await expect(batchLine).toContainText('An agent proposed 2 changes');
  await expect(batchLine).toContainText('FDR-INT-001');
  await expect(batchLine.getByRole('link', { name: /An agent proposed 2 changes/ })).toHaveAttribute(
    'href',
    `/p/${projectId}/batches/${batchId}`,
  );
  await expect(batchLine.getByRole('link', { name: 'Open FDR-INT-001' })).toHaveAttribute(
    'href',
    `/p/${projectId}/records/FDR-INT-001`,
  );
  await expect(summary).toContainText('Nothing you confirmed was changed.');

  // Only what changed is marked, with a word; nothing is dimmed.
  const main = page.getByRole('main');
  await expect(main.locator('[data-record="FDR-INT-001"][data-card]')).toHaveAttribute('data-changed', 'true');
  await expect(main.locator('[data-record="FDR-INT-001"]')).toContainText('Changed');
  await expect(main.locator(`[data-thread="${thread}"][data-card]`)).toHaveAttribute('data-changed', 'true');
  await expect(main.locator('[data-card][data-changed="true"]')).toHaveCount(2);
  await expect(main.locator('[data-record="FDR-DIS-001"]')).not.toHaveAttribute('data-changed', 'true');
  await expect(main.locator('[data-dimmed]')).toHaveCount(0);
  await expectAccessible(page, 'the overview with the lens on');

  // It follows the stream: what an agent does now comes in at once…
  const agent = await person.agent(projectId, 'another-agent');
  await agent.command('batch.submit', { summary: 'Guests pay', proposals: [decisionProposal('Guests pay like members')] });
  await expect(summary.locator('[data-id^="batch:"]')).toHaveCount(2);
  // …but what the person does in this session is not told back to them as "while you were away".
  const dec = await recordOf(person, projectId, 'DEC-PLN-001');
  await person.command(projectId, 'record_version.approve', {}, dec.versions[0]?.id);
  await expect(main.locator('[data-record="DEC-PLN-001"] [data-certainty] [data-status]')).toHaveAttribute(
    'data-status',
    'confirmed',
  );
  await expect(summary.locator('[data-id="record:DEC-PLN-001"]')).toHaveCount(0);
  await expect(main.locator('[data-record="DEC-PLN-001"]')).not.toHaveAttribute('data-changed', 'true');

  // "Show everything" turns the lens off; "What changed" turns it back on.
  await summary.getByRole('button', { name: 'Show everything' }).click();
  await expect(summary).toBeHidden();
  await expect(main.locator('[data-card][data-changed="true"]')).toHaveCount(0);
  await expectAccessible(page, 'the overview with the lens off');
  const toggle = page.getByRole('button', { name: /What changed/ });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(page.getByRole('region', { name: 'While you were away' })).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

test('AC-INT-001-16 without changes since the last visit there is no summary and nothing is marked', async ({ page, person }) => {
  const projectId = await ratifiedProject(person, 'Nothing new');
  await settled(person, projectId);
  // The first visit has no earlier one to compare with.
  await visit(page, projectId);
  await page.goto(`/p/${projectId}`);
  await expect(page.getByRole('main').locator('[data-record="FDR-DIS-001"]')).toBeVisible();
  await expect(page.getByRole('region', { name: 'While you were away' })).toHaveCount(0);
  await expect(page.getByRole('main').locator('[data-changed="true"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /What changed/ })).toHaveCount(0);
});

test('screens of cut 6: coming back with the lens on, the preview of what changed, and everything shown', async ({
  page,
  person,
}) => {
  const { projectId, thread } = await comingBack(page, person, 'Club Activities');
  // The person also approved the decision from another browser, and DEMIURGO answered in the thread.
  const dec = await recordOf(person, projectId, 'DEC-PLN-001');
  await person.command(projectId, 'record_version.approve', {}, dec.versions[0]?.id);
  await person.command(projectId, 'message.post', { exploration_id: thread, text: 'Guests pay like members?' });
  await person.until<{ state: string }[]>(
    `/api/projects/${projectId}/runs`,
    (runs) => runs.length > 0 && runs.every((r) => !['queued', 'running'].includes(r.state)),
    60_000,
  );
  await settled(person, projectId);

  await page.goto(`/p/${projectId}`);
  const summary = page.getByRole('region', { name: 'While you were away' });
  await expect(summary.locator('[data-id]').first()).toBeVisible();
  // Done from another browser before this visit: it is told, as the person's own.
  await expect(summary.locator('[data-id="record:DEC-PLN-001"]')).toContainText('You approved');
  await expect(page.getByRole('main').locator('[data-record="FDR-INT-001"][data-card]')).toHaveAttribute('data-changed', 'true');
  await screenshot(page, 6, '01-lens-on');
  await shot(page, 'lens-on');

  await page
    .getByRole('main')
    .locator('[data-record="FDR-INT-001"]')
    .getByRole('button', { name: /^Preview/ })
    .click();
  await expect(page.getByRole('dialog', { name: /Diseñar dentro de la v2/ })).toBeVisible();
  await screenshot(page, 6, '02-lens-preview');
  await page.keyboard.press('Escape');

  await summary.getByRole('button', { name: 'Show everything' }).click();
  await expect(summary).toBeHidden();
  await screenshot(page, 6, '03-lens-off');
});

test('AC-INT-001-16 coming back after an agent changed things: the lens tells what changed, and Catch up walks Needs you from there and can be left', async ({
  page,
  person,
}) => {
  test.setTimeout(150_000);
  const { projectId, batchId } = await comingBack(page, person, 'Back and catch up');
  await page.goto(`/p/${projectId}`);
  const summary = page.getByRole('region', { name: 'While you were away' });
  await expect(summary.locator(`[data-id="batch:${batchId}"]`)).toContainText('An agent proposed 2 changes');
  await expect(page.getByRole('main').locator('[data-record="FDR-INT-001"][data-card]')).toHaveAttribute('data-changed', 'true');

  // From the overview, catch up one thing at a time.
  await page
    .getByRole('complementary')
    .getByRole('link', { name: /catch up/i })
    .first()
    .click();
  await expect(page).toHaveURL(/needs-you\?catch-up=1/);
  const band = page.getByRole('region', { name: 'Catching up' });
  const progress = band.locator('[data-progress]');
  await expect(progress).toContainText(/^1 of \d+/);
  const total = Number(/of (\d+)/.exec((await progress.textContent()) ?? '')?.[1] ?? '0');
  expect(total).toBeGreaterThan(1);
  const first = await page.getByRole('main').locator('[data-need]').first().getAttribute('data-kind');
  await band.getByRole('button', { name: 'Skip' }).click();
  await expect(progress).toContainText(`2 of ${total}`);

  // Leaving keeps everything that was not resolved in Needs you, the skipped one included.
  await band.getByRole('button', { name: 'Leave' }).click();
  await expect(page).not.toHaveURL(/catch-up/);
  await expect(page.getByRole('main').locator(`[data-need][data-kind="${first}"]`).first()).toBeVisible();
  const count = page.getByRole('navigation', { name: 'Sections' }).locator('[data-nav="needs"] [data-count]');
  await expect(count).toBeVisible();
});
