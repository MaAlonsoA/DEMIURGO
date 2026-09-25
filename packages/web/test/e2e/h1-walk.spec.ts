// The H1 walk in the browser (FDR-INT-001, AC-INT-001-01): from design/ imported as a pending
// package, the person signs in, ratifies, settles what the ratification left for them, opens a
// thread, has DEMIURGO propose a decision and a draft, accepts the package and approves the
// feature. Everything after the import is done through the UI; the API is only read to wait for
// DEMIURGO's background work.

import type { Locator, Page } from '@playwright/test';
import {
  BASE_URL,
  type PersonApi,
  anonymousContext,
  expect,
  expectAccessible,
  screenshot,
  signInThroughUi,
  test,
} from './support/fixtures.ts';

type Knowledge = { up_to_date: boolean; updates_in_progress: number };

async function knowledgeSettled(person: PersonApi, projectId: string): Promise<void> {
  await person.until<Knowledge>(
    `/api/projects/${projectId}/knowledge`,
    (k) => k.up_to_date && k.updates_in_progress === 0,
    60_000,
  );
}

async function confirmIn(page: Page, name: string): Promise<void> {
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await dialog.getByRole('button', { name, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

/** Resolves whatever Needs you shows, one thing at a time, until nothing needs the person. */
async function settleNeedsYou(page: Page, person: PersonApi, projectId: string): Promise<string[]> {
  const done: string[] = [];
  for (let round = 0; round < 120; round++) {
    await knowledgeSettled(person, projectId);
    const empty = page.getByText('Nothing needs you. You can close DEMIURGO.');
    const item = page.getByRole('main').locator('[data-need]').first();
    await expect(empty.or(item)).toBeVisible();
    if (await empty.isVisible()) {
      // The knowledge may still bring a conflict after the last approval: check once more.
      await knowledgeSettled(person, projectId);
      if (await empty.isVisible()) return done;
      continue;
    }
    const key = (await item.getAttribute('data-need')) ?? '';
    const kind = (await item.getAttribute('data-kind')) ?? '';
    // Acts on that thing by its key, not on "the first one": knowledge can put a new conflict on top
    // between reading it and clicking, and "the first one" would then have none of these buttons.
    const target = page.locator(`[data-need="${key}"]`);
    try {
      await settleOne(page, target, kind, key);
    } catch (e) {
      // It went away or changed before the click: look at Needs you again.
      if (e instanceof Error && e.name === 'TimeoutError') continue;
      throw e;
    }
    // Under load (three workers share one serial knowledge queue) an approval can wait for the project lock.
    await expect(target).toHaveCount(0, { timeout: 45_000 });
    done.push(kind);
  }
  throw new Error('Needs you never emptied.');
}

/** Resolves one thing of Needs you in place; a button that doesn't come in 15 s is a TimeoutError. */
async function settleOne(page: Page, item: Locator, kind: string, key: string): Promise<void> {
  const click = (name: string, exact = true) => item.getByRole('button', { name, exact }).click({ timeout: 15_000 });
  switch (kind) {
    case 'version': {
      if (await item.getByRole('button', { name: 'Approve', exact: true }).isVisible()) {
        await click('Approve');
        await confirmIn(page, 'Approve');
      } else {
        await click('Discard');
        await confirmIn(page, 'Discard');
      }
      break;
    }
    case 'conflict':
      await click('Keep it as it is', false);
      await confirmIn(page, 'Keep it as it is');
      break;
    case 'link':
      await click('Keep');
      break;
    case 'update':
      await click('Retry');
      break;
    case 'question': {
      if (await item.getByRole('button', { name: 'Confirm', exact: true }).isVisible()) {
        await click('Confirm');
        await confirmIn(page, 'Confirm');
      } else {
        await click('Answer');
        await page.getByRole('dialog').getByLabel('Conclusion').fill('Settled while walking H1.');
        await confirmIn(page, 'Answer');
      }
      break;
    }
    default:
      throw new Error(`Needs you shows something the H1 walk did not expect: ${kind} (${key})`);
  }
}

test('AC-INT-001-01 the H1 walk in the browser: ratify, a thread, a draft, accept the package and approve the feature, then it is Ready to build and Needs you is empty', async ({
  browser,
  person,
}) => {
  test.setTimeout(420_000);
  const projectId = await person.createProject('H1 walk');
  const { batchId } = await person.importDesign(projectId);

  // The person signs in through the UI and finds the imported package in Needs you.
  const context = await anonymousContext(browser);
  const page = await context.newPage();
  await page.goto(`/p/${projectId}/needs-you`);
  await signInThroughUi(page);
  await expect(page).toHaveURL(`${BASE_URL}/p/${projectId}/needs-you`);
  await page.locator(`[data-need="package:${batchId}"]`).getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/batches/${batchId}$`));

  // 1. Take over the design: nothing is approved before ratifying.
  await expect(page.getByRole('heading', { name: 'Imported from design/' })).toBeVisible();
  await expectAccessible(page, 'the imported package');
  await page.getByRole('button', { name: 'Ratify' }).click();
  await confirmIn(page, 'Ratify');
  await expect(page.getByText('Ratified').first()).toBeVisible();

  // 2. Approve what is right: whatever the ratification left in Needs you.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: /Needs you/ })
    .click();
  const settled = await settleNeedsYou(page, person, projectId);
  expect(settled.filter((k) => k === 'version').length).toBeGreaterThanOrEqual(13);
  await expectAccessible(page, 'Needs you, empty');

  // 3. A thread: the person decides and DEMIURGO proposes the decision.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Threads' }).click();
  await page.getByRole('button', { name: 'New thread' }).click();
  await page.getByRole('dialog').getByLabel('Purpose').fill('Design S3: change set and frozen tests');
  await page.getByRole('dialog').getByRole('button', { name: 'Open thread' }).click();
  await expect(page).toHaveURL(/\/threads\/[0-9a-f-]+$/);
  await expectAccessible(page, 'a new thread');
  await page.getByLabel('Message').fill("We'll use a map of checks that the person accepts before the tests are frozen.");
  await page.getByRole('button', { name: 'Ask DEMIURGO' }).click();
  const proposed = page.locator('[data-message-by="demiurgo"] [data-proposed]');
  await expect(proposed).toContainText('Proposed 1 decision for you to review.', { timeout: 60_000 });
  await proposed.getByRole('link', { name: /Review/ }).click();

  // The decision, accepted and approved in one gesture, on its batch page.
  await expect(page).toHaveURL(/\/batches\//);
  await expectAccessible(page, 'the decision DEMIURGO proposed');
  await page.getByRole('button', { name: 'Accept and approve' }).first().click();
  await confirmIn(page, 'Accept and approve');
  await knowledgeSettled(person, projectId);
  await page.goBack();

  // 4. Draft it: DEMIURGO drafts the feature from the decision born in this thread.
  await expect(page.getByRole('button', { name: 'Draft it' })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Draft it' }).click();
  await page.getByRole('menuitem').filter({ hasText: 'From this thread' }).first().click();
  const ready = page.locator('[data-run-card="draft"]');
  await expect(ready).toContainText('A draft is ready:', { timeout: 60_000 });
  await ready.getByRole('link', { name: /Review/ }).click();

  // 5. Accept the package, then approve the feature on its page.
  await expect(page).toHaveURL(/\/batches\//);
  await expectAccessible(page, "DEMIURGO's package");
  await page.getByRole('button', { name: 'Accept package' }).click();
  await confirmIn(page, 'Accept package');
  await knowledgeSettled(person, projectId);
  const state = await person.get<{ designs: { code: string; title: string; current: number | null }[] }>(
    `/api/projects/${projectId}/state`,
  );
  const fdr = state.designs.find((d) => d.title.startsWith('Design:') && d.current === null);
  expect(fdr, 'the drafted feature exists as a draft').toBeTruthy();
  await page.goto(`/p/${projectId}/records/${fdr?.code}`);
  await expectAccessible(page, 'the drafted feature');
  await page.getByRole('button', { name: 'Approve', exact: true }).first().click();
  await confirmIn(page, 'Approve');

  // Whatever the approval brought (a conflict, a link) is settled; then Needs you is empty.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: /Needs you/ })
    .click();
  await settleNeedsYou(page, person, projectId);
  await expect(page.getByText('Nothing needs you. You can close DEMIURGO.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' }).locator('[data-needs]')).toHaveCount(0);
  await screenshot(page, 8, 'h1-01-needs-you-empty');

  // The feature is Ready to build: no reasons and the first bar full.
  await page.goto(`/p/${projectId}/records/${fdr?.code}`);
  await expect(page.getByText('Ready to build').first()).toBeVisible();
  await expect(page.locator('[data-stage="ready"]').first()).toBeVisible();
  await expect(page.locator('[data-readiness-reasons]')).toHaveCount(0);
  await screenshot(page, 8, 'h1-02-feature-ready');
  await context.close();
});
