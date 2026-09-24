import type { EventRow, IdeaAssessment, Knowledge, KnowledgeGraph, RecordDetail, Taxonomy } from '../../src/api/types.ts';
import { agentIdeas, approveRecord, approveTaxonomy, foldLegend, ratifiedProject, settled } from './knowledge-data.ts';
import { expect, expectAccessible, screenshot, test } from './support/fixtures.ts';

const api = (projectId: string, path: string) => `/api/projects/${projectId}${path}`;

test('AC-INT-001-17 the header and the page show the graph version and its freshness, and an idea check shows its citation', async ({
  page,
  person,
}) => {
  const projectId = await ratifiedProject(person, 'Knowledge and idea checks');
  await settled(person, projectId);
  const ideas = await agentIdeas(person, projectId);
  const knowledge = await settled(person, projectId);
  const assessments = await person.get<IdeaAssessment[]>(api(projectId, '/knowledge/idea-assessments'));
  const mine = assessments.find((a) => a.proposal.title === ideas.duplicate);
  const finding = mine?.findings.find((f) => f.verdict === 'duplicates');
  if (!mine || !finding?.record || !finding.label) throw new Error('The idea was not found to duplicate a record.');
  const batchId = ideas.batchId;

  await page.goto(`/p/${projectId}/knowledge`);
  // The header: graph version and a dot that says it is up to date.
  await expect(page.getByRole('link', { name: `Knowledge version ${knowledge.graph_version}: up to date` })).toBeVisible();
  const line = page.locator('[data-knowledge-freshness]');
  await expect(line).toHaveAttribute('data-knowledge-freshness', 'current');
  await expect(line).toContainText('Up to date');
  await expect(line).toContainText(`Graph version ${knowledge.graph_version}`);
  await expect(line).toContainText(`${knowledge.current_nodes} nodes`);

  await page.getByRole('tab', { name: 'Idea checks' }).click();
  await expect(page).toHaveURL(/tab=ideas/);
  const check = page.getByRole('article', { name: `Idea check: ${ideas.duplicate}` });
  await expect(check).toBeVisible();
  // The proposal it checked, with its batch; and each finding with its verdict and the cited node.
  await expect(check.getByRole('link', { name: /Open its batch/ })).toHaveAttribute('href', `/p/${projectId}/batches/${batchId}`);
  const citation = check.getByRole('listitem').filter({ hasText: 'Duplicates' }).getByRole('link');
  await expect(citation).toContainText(finding.label);
  await expect(citation).toContainText(finding.citation);
  // The idea that contradicts a record takes the conflict look.
  const conflict = page.getByRole('article', { name: `Idea check: ${ideas.contradiction}` });
  await expect(conflict.getByText('Conflict', { exact: true })).toBeVisible();
  await expect(conflict.getByText('Contradicts', { exact: true })).toBeVisible();
  await expect(conflict.getByRole('link', { name: /ADR-AGE-001@\d+/ })).toBeVisible();
  await expectAccessible(page, 'Knowledge · Idea checks');
  await citation.click();
  await expect(page).toHaveURL(new RegExp(`/records/${finding.record.code}\\?v=${finding.record.version}$`));
});

test('AC-INT-001-17 the person approves the proposed taxonomy and it shows as approved', async ({ page, person }) => {
  const projectId = await ratifiedProject(person, 'Taxonomy approval');
  await page.goto(`/p/${projectId}/knowledge?tab=taxonomy`);
  const taxonomy = page.getByRole('article', { name: /^TAX-001 v1/ });
  await expect(taxonomy.getByText('Proposed', { exact: true })).toBeVisible();
  // Its axes and their categories, as data.
  await expect(taxonomy.getByRole('heading', { name: 'Área del producto' })).toBeVisible();
  await expect(taxonomy.getByText('Conocimiento', { exact: true })).toBeVisible();
  await expectAccessible(page, 'Knowledge · Taxonomy');

  await taxonomy.getByRole('button', { name: 'Approve' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Approve TAX-001 v1?');
  await dialog.getByRole('button', { name: 'Approve' }).click();
  await expect(dialog).toBeHidden();
  await expect(taxonomy.getByText('Approved', { exact: true })).toBeVisible();
  await expect(taxonomy.getByText(/Approved by/)).toBeVisible();
  await expect(taxonomy.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  const [stored] = await person.get<Taxonomy[]>(api(projectId, '/taxonomies'));
  expect(stored).toMatchObject({ state: 'approved', approved_by: 'human:ana' });
});

test('AC-INT-001-17 the person proposes a new taxonomy version from the current one, and a broken rule shows its reasons without losing the edit', async ({
  page,
  person,
}) => {
  const projectId = await ratifiedProject(person, 'Taxonomy proposal');
  await approveTaxonomy(person, projectId);
  await page.goto(`/p/${projectId}/knowledge?tab=taxonomy`);
  await page.getByRole('button', { name: 'Propose a new version' }).click();
  const editor = page.getByRole('form', { name: 'New version of TAX-001' });
  await expect(editor.getByLabel('Title', { exact: true })).toHaveValue('Taxonomía inicial del producto');

  const axis = editor.getByRole('group', { name: 'Área del producto' });
  await axis.getByRole('button', { name: 'Add a category' }).click();
  await axis.getByLabel('Name of the new category').fill('Interfaz web');
  await axis.getByLabel('Description of Interfaz web').fill('Pantallas, navegación y lenguaje visual.');
  await expect(axis.getByLabel('Code of Interfaz web')).toHaveValue('interfaz_web');
  // Without its "other" category the server refuses it, with its reason; what was written stays.
  await axis.getByRole('button', { name: 'Remove Otra' }).click();
  await editor.getByRole('button', { name: 'Propose', exact: true }).click();
  const reasons = editor.getByRole('alert');
  await expect(reasons).toContainText('Axis area has no "other" category.');
  await expect(axis.getByLabel('Description of Interfaz web')).toHaveValue('Pantallas, navegación y lenguaje visual.');
  await expectAccessible(page, 'Knowledge · New taxonomy version');

  await axis.getByRole('button', { name: 'Add a category' }).click();
  await axis.getByLabel('Name of the new category').fill('Otra');
  await axis.getByLabel('Code of Otra').fill('other');
  await axis.getByLabel('Description of Otra').fill('Ningún área encaja sin forzarla.');
  await editor.getByRole('button', { name: 'Propose', exact: true }).click();
  await expect(editor).toBeHidden();
  const v2 = page.getByRole('article', { name: /^TAX-001 v2/ });
  await expect(v2.getByText('Proposed', { exact: true })).toBeVisible();
  await expect(v2.getByText('Interfaz web', { exact: true })).toBeVisible();
  const stored = await person.get<Taxonomy[]>(api(projectId, '/taxonomies'));
  expect(stored.map((t) => [t.version, t.state])).toEqual([
    [2, 'draft'],
    [1, 'approved'],
  ]);
});

test('AC-INT-001-17 the graph groups the nodes by taxonomy area and a node shows its relations in the peek', async ({
  page,
  person,
}) => {
  const projectId = await ratifiedProject(person, 'Knowledge graph');
  await approveTaxonomy(person, projectId);
  await approveRecord(person, projectId, 'DEC-PLN-001');
  await approveRecord(person, projectId, 'FDR-DIS-001');
  await settled(person, projectId);
  const graph = await person.get<KnowledgeGraph>(api(projectId, '/knowledge/graph'));
  const [taxonomy] = await person.get<Taxonomy[]>(api(projectId, '/taxonomies'));
  const fdr = graph.nodes.find((n) => n.ref === 'FDR-DIS-001@1');
  const axes = (taxonomy?.axes ?? []) as { code: string; categories: { code: string; name: string }[] }[];
  const area = axes[0]?.categories.find((c) => c.code === fdr?.areas.area);
  if (!fdr || !area) throw new Error('FDR-DIS-001 was not classified.');

  await page.goto(`/p/${projectId}/knowledge`);
  await expect(page.getByRole('tab', { name: 'Graph', selected: true })).toBeVisible();
  await expect(page.getByText('Grouped by Área del producto (TAX-001 v1)')).toBeVisible();
  const section = page.getByRole('region', { name: area.name });
  await expect(section).toBeVisible();
  await expect(page.getByRole('region', { name: 'Not classified yet' })).toBeVisible();
  await expectAccessible(page, 'Knowledge · Graph');

  // Focus shows the peek at once: the relations of the node, both ways, with the other node.
  const node = section.getByRole('link', { name: `Feature: ${fdr.label} (FDR-DIS-001@1)` });
  await node.focus();
  const peek = page.getByRole('dialog');
  await expect(peek).toContainText('Based on');
  await expect(peek).toContainText('DEC-PLN-001@1');
  await expect(peek).toContainText('Contains');
  await expectAccessible(page, 'Knowledge · Graph with a peek');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/records/FDR-DIS-001\\?v=1$`));

  // The filter keeps only one type.
  await page.goBack();
  await page.getByRole('button', { name: /^Features/ }).click();
  await expect(page.getByRole('link', { name: /^Check: / })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Feature: / }).first()).toBeVisible();
});

test('AC-INT-001-17 searching the knowledge lists what matches and links each result to its record', async ({ page, person }) => {
  const projectId = await ratifiedProject(person, 'Knowledge search');
  await settled(person, projectId);
  const { results } = await person.get<{ results: { ref: string; title: string }[] }>(
    api(projectId, '/knowledge/search?q=agentes'),
  );
  const first = results[0];
  if (!first) throw new Error('The search found nothing.');

  await page.goto(`/p/${projectId}/knowledge?tab=search`);
  const field = page.getByLabel('Search the knowledge');
  await field.fill('agentes');
  await field.press('Enter');
  const list = page.getByRole('list', { name: 'Results' });
  await expect(list.getByRole('listitem')).toHaveCount(results.length);
  await expect(list.getByRole('listitem').first()).toContainText(first.title);
  await expect(list.getByRole('listitem').first()).toContainText(first.ref);
  await expectAccessible(page, 'Knowledge · Search');
  await list.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/records\/[A-Z]{3}-[A-Z]{3}-\d{3}\?v=\d+$/);
});

test('AC-INT-001-17 the rebuild tab shows the fingerprint of the live graph and of its rebuild, and that they match', async ({
  page,
  person,
}) => {
  const projectId = await ratifiedProject(person, 'Knowledge rebuild');
  await settled(person, projectId);
  const rebuild = await person.get<{ live: string; rebuilt: string; equal: boolean }>(api(projectId, '/knowledge/rebuild'));
  expect(rebuild.equal).toBe(true);
  await page.goto(`/p/${projectId}/knowledge?tab=rebuild`);
  await expect(page.getByText('They match', { exact: true })).toBeVisible();
  await expect(page.locator('[data-fingerprint="live"]')).toHaveText(rebuild.live);
  await expect(page.locator('[data-fingerprint="rebuilt"]')).toHaveText(rebuild.rebuilt);
  await expectAccessible(page, 'Knowledge · Rebuild');
});

test('AC-INT-001-17 an update that failed puts the header behind, says why, and the person retries it', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Knowledge retry');
  // A taxonomy makes the classifier run; the marker makes it fail its first three calls, one per
  // attempt: the update is rejected, and it takes the person three retries to go through.
  const taxonomy = await person.command(projectId, 'taxonomy.propose', {
    code: 'TAX-001',
    title: 'Areas',
    axes: [
      {
        code: 'area',
        name: 'Area',
        categories: [
          { code: 'design', name: 'Design', description: 'Decisions and features.' },
          { code: 'other', name: 'Other', description: 'Nothing else fits.' },
        ],
      },
    ],
  });
  await person.command(projectId, 'taxonomy.approve', {}, taxonomy.entity_id);
  const created = await person.command<{ versionId: string }>(projectId, 'record.create', {
    type: 'decision',
    domain: 'club',
    title: 'Sign-ups are instant [classifier-fails]',
    sections: [
      { title: 'Context', content: 'Members sign up for activities.' },
      { title: 'Decision', content: 'Signing up needs no approval.' },
      { title: 'Consequences', content: 'Organizers see sign-ups at once.' },
    ],
  });
  await person.command(projectId, 'record_version.approve', {}, created.result?.versionId);
  await person.until<Knowledge>(api(projectId, '/knowledge'), (k) => k.updates.some((u) => u.state === 'rejected'), 60_000);

  await page.goto(`/p/${projectId}/knowledge`);
  await expect(page.getByRole('link', { name: /Knowledge version \d+: behind/ })).toBeVisible();
  await expect(page.locator('[data-knowledge-freshness]')).toHaveAttribute('data-knowledge-freshness', 'behind');
  const updates = page.getByRole('region', { name: 'Latest updates' });
  const failed = updates.getByRole('listitem').filter({ hasText: 'Failed' });
  await expect(failed).toContainText('Approval of DEC-CLU-001 v1');
  await expect(failed).toContainText('failed on purpose');
  await expectAccessible(page, 'Knowledge · a failed update');
  for (let retry = 1; retry <= 3; retry++) {
    await failed.getByRole('button', { name: 'Retry', exact: true }).click();
    // The update goes back to the queue and is processed again: rejected once more, or applied.
    const events = await person.until<EventRow[]>(
      api(projectId, '/events?from=0'),
      (e) => finished(e, 'knowledge_update.reject') > retry || finished(e, 'knowledge_update.apply') > 0,
    );
    expect(events.filter((e) => e.command === 'knowledge_update.retry').map((e) => e.actor)).toEqual(
      Array.from({ length: retry }, () => 'human:ana'),
    );
    if (finished(events, 'knowledge_update.apply') > 0) break;
  }
  await expect(page.getByRole('link', { name: /Knowledge version \d+: up to date/ })).toBeVisible();
  await expect(page.locator('[data-knowledge-freshness]')).toHaveAttribute('data-knowledge-freshness', 'current');
  await expect(updates.getByRole('listitem').filter({ hasText: 'Failed' })).toHaveCount(0);
  await expect(updates.getByRole('listitem').filter({ hasText: 'Approval of DEC-CLU-001 v1' })).toContainText('Applied');
});

test('screens of cut 7: knowledge graph, search, idea checks, taxonomy and rebuild', async ({ page, person }) => {
  test.setTimeout(180_000);
  const projectId = await ratifiedProject(person, 'DEMIURGO');
  await approveTaxonomy(person, projectId);
  for (const code of ['DEC-PLN-001', 'FDR-DIS-001', 'ADR-STK-001', 'ADR-CLA-001', 'FDR-CON-001']) {
    await approveRecord(person, projectId, code);
  }
  await settled(person, projectId);
  await agentIdeas(person, projectId);
  await settled(person, projectId);

  await page.goto(`/p/${projectId}/knowledge`);
  await expect(page.getByRole('region', { name: 'Not classified yet' })).toBeVisible();
  await foldLegend(page);
  await screenshot(page, 7, '20-knowledge-graph');
  const record = await person.get<RecordDetail>(api(projectId, '/records/FDR-DIS-001'));
  await page
    .getByRole('link', { name: `Feature: ${record.versions[0]?.title ?? ''} (FDR-DIS-001@1)` })
    .first()
    .focus();
  await expect(page.getByRole('dialog')).toBeVisible();
  await screenshot(page, 7, '21-knowledge-graph-peek');
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Search' }).click();
  await page.getByLabel('Search the knowledge').fill('agentes');
  await page.getByLabel('Search the knowledge').press('Enter');
  await expect(page.getByRole('list', { name: 'Results' })).toBeVisible();
  await screenshot(page, 7, '22-knowledge-search');

  await page.getByRole('tab', { name: 'Idea checks' }).click();
  await expect(page.getByRole('article').first()).toBeVisible();
  await screenshot(page, 7, '23-knowledge-idea-checks');

  await page.getByRole('tab', { name: 'Taxonomy' }).click();
  await expect(page.getByRole('article', { name: /^TAX-001 v1/ })).toBeVisible();
  await screenshot(page, 7, '24-knowledge-taxonomy');
  await page.getByRole('button', { name: 'Propose a new version' }).click();
  await expect(page.getByRole('form', { name: 'New version of TAX-001' })).toBeVisible();
  await screenshot(page, 7, '25-knowledge-taxonomy-propose');

  await page.getByRole('tab', { name: 'Rebuild' }).click();
  await expect(page.getByText('They match', { exact: true })).toBeVisible();
  await screenshot(page, 7, '26-knowledge-rebuild');
});

/** How many events of a command the journal has. */
function finished(events: EventRow[], command: string): number {
  return events.filter((e) => e.command === command).length;
}
