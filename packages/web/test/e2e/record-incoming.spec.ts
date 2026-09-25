// What connects to a record (INV-REC-21, AC-INT-002-08): the record page lists the records that
// point to it, not only what it points to. Moved out of views.spec.ts so the record screens own it.

import { foldLegend, ratifiedProject } from './record-setup.ts';
import { expect, test } from './support/fixtures.ts';

test('AC-INT-002-08 a record says what connects to it, not only what it points to', async ({ page, person }) => {
  await foldLegend(page);
  const projectId = await ratifiedProject(person, 'What connects');
  await page.goto(`/p/${projectId}/records/ADR-AGE-001`);
  const incoming = page.locator('[data-incoming]');
  await expect(incoming).toContainText('Followed by');
  const from = incoming.getByRole('link', { name: 'Agentes y proveedores' });
  await expect(from).toBeVisible();
  await from.click();
  await expect(page).toHaveURL(new RegExp(`/p/${projectId}/records/FDR-AGE-002`));
});
