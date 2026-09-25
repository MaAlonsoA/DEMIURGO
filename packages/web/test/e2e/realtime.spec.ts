import { expect, test } from './support/fixtures.ts';

test('AC-INT-001-15 an open screen shows what another actor changes, without reloading the page', async ({ page, person }) => {
  const projectId = await person.createProject('Real time');
  const agent = await person.agent(projectId);
  await page.goto(`/p/${projectId}/threads`);
  // The count of Needs you lives in the sidebar, on every page.
  const needsYou = page.locator('nav [data-nav="needs"]');
  await expect(needsYou).toBeVisible();
  await expect(needsYou.locator('[data-count]')).toHaveCount(0);
  // A mark on the window: if the page reloaded, it would be gone.
  await page.evaluate(() => {
    (window as unknown as { stillHere: boolean }).stillHere = true;
  });

  await agent.command('batch.submit', {
    proposals: [
      {
        type: 'decision',
        payload: {
          title: 'Two guests per member',
          context: 'Limited capacity.',
          decision: 'Two guests.',
          consequences: 'Counted.',
        },
      },
      {
        type: 'decision',
        payload: { title: 'Guests sign in at the door', context: 'Safety.', decision: 'A list.', consequences: 'A volunteer.' },
      },
    ],
  });

  await expect(needsYou.locator('[data-count]')).toHaveAttribute('data-count', '2');
  await expect(needsYou).toContainText('2 things need you');
  expect(await page.evaluate(() => (window as unknown as { stillHere?: boolean }).stillHere)).toBe(true);
});
