import { foldLegend, threadToFeature } from './knowledge-data.ts';
import { expect, expectAccessible, screenshot, test } from './support/fixtures.ts';

test('AC-INT-001-04 Origins goes from a thread to its decision and to the feature drafted from it, each with its mark, and says why it exists', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Origins');
  const walk = await threadToFeature(person, projectId);
  if (!walk.decision || !walk.feature) throw new Error('The thread did not end in a decision and a feature.');

  await page.goto(`/p/${projectId}/origins`);
  await expect(page.getByRole('navigation', { name: 'Product views' }).getByRole('link', { name: 'Origins' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const tree = page.getByRole('list', { name: 'Origins' });
  const thread = tree.getByRole('link', { name: new RegExp(`Thread.*${walk.purpose}`) });
  const decision = tree.getByRole('link', { name: new RegExp(`Decision.*${escape(walk.decision.title)}`) });
  const feature = tree.getByRole('link', { name: new RegExp(`Feature.*${escape(walk.feature.title)}`) });
  await expect(thread).toBeVisible();
  // The decision was approved by the person (Confirmed); the drafted feature is only proposed.
  await expect(decision.getByRole('img', { name: 'Confirmed' })).toBeVisible();
  await expect(feature.getByRole('img', { name: 'Proposed' })).toBeVisible();
  await expect(feature.getByRole('img', { name: 'Confirmed' })).toHaveCount(0);
  // Each branch carries why it exists: the thread's conclusion.
  await expect(decision).toContainText(walk.conclusion);
  await expectAccessible(page, 'Origins');

  // Pointing at the feature lights its trace and says why it exists.
  await feature.hover();
  const why = page.getByRole('region', { name: 'Why does this exist?' });
  await expect(why).toContainText(`“${walk.feature.title}” is a feature that follows the decision “${walk.decision.title}”`);
  await expect(why).toContainText(`which came from the thread “${walk.purpose}”`);
  await expect(why).toContainText(walk.conclusion);
  for (const n of [thread, decision, feature]) await expect(n).toHaveAttribute('data-traced', 'true');
  await expectAccessible(page, 'Origins with a trace');
  await why.getByRole('link', { name: `“${walk.decision.title}”` }).click();
  await expect(page).toHaveURL(new RegExp(`/records/${walk.decision.code}$`));
});

test('AC-WEB-001-03 Origins can be walked with the keyboard: focus lights the trace and Enter opens the node', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Origins by keyboard');
  const walk = await threadToFeature(person, projectId);
  await page.goto(`/p/${projectId}/origins`);
  const tree = page.getByRole('list', { name: 'Origins' });
  const feature = tree.getByRole('link', { name: new RegExp(`Feature.*${escape(walk.feature?.title ?? '')}`) });
  await expect(feature).toBeVisible();
  for (let i = 0; i < 40 && !(await feature.evaluate((el) => el === document.activeElement)); i++)
    await page.keyboard.press('Tab');
  await expect(feature).toBeFocused();
  await expect(feature).toHaveAttribute('data-traced', 'true');
  await expect(page.getByRole('region', { name: 'Why does this exist?' })).toContainText(`“${walk.feature?.title}”`);
  await page.getByRole('button', { name: 'Clear trace' }).focus();
  await page.keyboard.press('Enter');
  await expect(feature).not.toHaveAttribute('data-traced', 'true');
  await feature.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/records/${walk.feature?.code}$`));
});

test('screens of cut 7: origins', async ({ page, person }) => {
  test.setTimeout(180_000);
  const projectId = await person.createProject('DEMIURGO');
  const walk = await threadToFeature(person, projectId);
  // design/ ratified afterwards: what does not come from a thread starts on its own lane.
  const { batchId } = await person.importDesign(projectId);
  await person.command(projectId, 'batch.accept_package', {}, batchId);
  await person.command(projectId, 'exploration.open', {
    purpose: 'Waiting lists when an activity is full',
    parent_id: walk.threadId,
  });
  await person.command(projectId, 'exploration.open', { purpose: 'Guest passes for non-members' });
  await page.goto(`/p/${projectId}/origins`);
  const tree = page.getByRole('list', { name: 'Origins' });
  await expect(tree.getByRole('link', { name: /FDR-DIS-001/ })).toBeVisible();
  await foldLegend(page);
  await screenshot(page, 7, '28-origins');
  await tree.getByRole('link', { name: new RegExp(`Feature.*${escape(walk.feature?.title ?? '')}`) }).hover();
  await expect(page.getByRole('region', { name: 'Why does this exist?' })).toContainText('is a feature');
  // The trace stays when the pointer leaves, until "Clear trace".
  await screenshot(page, 7, '29-origins-trace');
});

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
