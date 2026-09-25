// You're up to date (INV-NEED-21…25, AC-INT-001-11): with nothing left, Needs you says so, tells what
// was done today and what still runs, and that DEMIURGO can be closed — also at the end of Catch up.
// Moved out of fidelity.spec.ts so the Needs you screens own it (the rebuild splits specs by screen).

import type { RunListItem } from '../../src/api/types.ts';
import { createDecision } from './record-setup.ts';
import { expect, expectAccessible, test } from './support/fixtures.ts';

test('AC-INT-001-11 with nothing left, Needs you says you are up to date and you can close DEMIURGO', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Up to date');
  await createDecision(person, projectId, 'Members sign up themselves', { approve: true });
  const thread = await person.command(projectId, 'exploration.open', { purpose: 'Guests at activities' });
  await person.command(projectId, 'message.post', {
    exploration_id: thread.entity_id,
    text: '[slow] Think about guests before answering.',
  });
  await person.until<RunListItem[]>(`/api/projects/${projectId}/runs`, (runs) => runs.some((r) => r.state === 'running'), 45_000);
  await person.until<{ total: number }>(`/api/projects/${projectId}/inbox`, (i) => i.total === 0, 45_000);

  await page.goto(`/p/${projectId}/needs-you`);
  await expect(page.getByRole('heading', { level: 1, name: "You're up to date" })).toBeVisible();
  const today = page.getByRole('region', { name: /^Today/ });
  await expect(today).toContainText('You added and approved Members sign up themselves.');
  await expect(today).toContainText('You opened Guests at activities.');
  await expect(today.locator('[data-who]').first()).toHaveAttribute('data-who', 'you');
  const running = page.getByRole('region', { name: 'In progress' });
  await expect(running).toContainText('Guests at activities');
  await expect(running.locator('[data-mark="working"]')).toHaveCount(1);
  await expect(page.getByText('Nothing needs you. You can close DEMIURGO.')).toBeVisible();
  await expect(
    page.getByText("Everything is saved. When you come back, I'll show you what changed while you were away."),
  ).toBeVisible();
  await expectAccessible(page, 'Needs you up to date');

  // The same at the end of Catch up, once the last thing is resolved.
  const other = await person.createProject('Up to date after catching up');
  await createDecision(person, other, 'Organizers set a limit on places');
  await page.goto(`/p/${other}/needs-you?catch-up=1`);
  const focus = page.getByRole('main').locator('[data-need]').first();
  await expect(focus).toHaveAttribute('data-kind', 'version');
  await focus.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('heading', { level: 1, name: "You're up to date" })).toBeVisible();
  await expect(page.getByRole('region', { name: /^Today/ })).toContainText('Organizers set a limit on places');
  await expect(page.getByText('Nothing needs you. You can close DEMIURGO.')).toBeVisible();
  await expectAccessible(page, 'the end of Catch up');
});
