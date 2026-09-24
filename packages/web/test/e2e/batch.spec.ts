import { agentBatch, assessed, decision, decisionProposal, designPackage, newApprovedVersion } from './needs-data.ts';
import { BASE_URL, designTree, expect, expectAccessible, screenshot, test } from './support/fixtures.ts';

type Batch = { state: string; proposals: { id: string; state: string; resolution: Record<string, unknown> | null }[] };
type EventRow = { actor: string; command: string };

const RATIFY_COMMANDS = new Set([
  'batch.accept_package',
  'proposal.accept',
  'record.create',
  'record_version.create',
  'criterion.record',
  'link.create',
  'taxonomy.propose',
]);

test("AC-INT-001-03 the imported package shows its counts next to design/'s with nothing approved, and after Ratify the records exist and every event is the person's", async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Ratify');
  const imported = await person.importDesign(projectId);
  await page.goto(`/p/${projectId}/batches/${imported.batchId}`);

  await expect(page.getByRole('heading', { level: 1, name: 'Imported from design/' })).toBeVisible();
  const inside = page.getByRole('table', { name: "What's inside" });
  const c = (k: string) => imported.counts[k] ?? 0;
  const records = c('decision') + c('adr') + c('fdr') + c('bug');
  for (const [kind, n] of [
    ['Records', records],
    ['Versions', c('versions')],
    ['Checks', c('criteria')],
    ['Links', c('links')],
    ['Taxonomies', c('taxonomies')],
    ['Annexes', c('annexes')],
  ] as const) {
    const row = inside.getByRole('row', { name: new RegExp(`^${kind}`) });
    await expect(row.getByRole('rowheader')).toHaveText(kind);
    await expect(row.getByRole('cell')).toHaveText([String(n), String(n)]);
    await expect(row.getByRole('img', { name: 'Same as design/' })).toBeVisible();
  }

  // Before ratifying nothing looks approved: every document is Proposed.
  const documents = page.getByRole('region', { name: 'Documents' });
  await expect(documents.getByRole('listitem')).toHaveCount(imported.proposals);
  await expect(documents.locator('[data-mark="proposed"]')).toHaveCount(imported.proposals);
  await expect(page.getByRole('main').locator('[data-mark="confirmed"]')).toHaveCount(0);

  // "Open ▸" shows the document in place: its sections and its checks.
  const web = documents.getByRole('listitem').filter({ hasText: 'ADR-WEB-001' });
  await web.getByRole('button', { name: /Open/ }).click();
  await expect(web.getByRole('heading', { name: 'Decision' })).toBeVisible();
  await expect(web.getByText('AC-WEB-001-01')).toBeVisible();
  await expect(web.getByText('Mismo origen y CSRF')).toBeVisible();
  await expectAccessible(page, 'the imported package');

  await page.getByRole('button', { name: 'Ratify', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText(`Ratify ${imported.proposals} proposals?`);
  await expect(dialog).toContainText('This makes DEMIURGO the home of your design.');
  await dialog.getByRole('button', { name: 'Ratify' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Ratified')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the product' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ratify', exact: true })).toHaveCount(0);

  const state = await person.get<{ decisions: { code: string }[]; designs: { code: string }[] }>(
    `/api/projects/${projectId}/state`,
  );
  expect(state.decisions.length + state.designs.length).toBe(records);
  const events = await person.get<EventRow[]>(`/api/projects/${projectId}/events`);
  const ratification = events.filter((e) => RATIFY_COMMANDS.has(e.command));
  expect(ratification.length).toBeGreaterThan(records);
  expect(new Set(ratification.map((e) => e.actor))).toEqual(new Set(['human:ana']));
});

test('AC-WEB-001-01 Ratify from the UI goes to the same origin with the session cookie and the CSRF header, and the same request without the header gets 403', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Same origin');
  const imported = await person.importDesign(projectId);
  await page.goto(`/p/${projectId}/batches/${imported.batchId}`);
  await page.getByRole('button', { name: 'Ratify', exact: true }).click();
  const sent = page.waitForRequest((r) => r.url().includes('/commands/batch.accept_package'));
  await page.getByRole('alertdialog').getByRole('button', { name: 'Ratify' }).click();
  const request = await sent;
  expect(new URL(request.url()).origin).toBe(BASE_URL);
  const headers = await request.allHeaders();
  expect(headers['x-demiurgo-csrf']).toBeTruthy();
  expect(headers.cookie).toContain('demiurgo_session=');
  await expect(page.getByText('Ratified')).toBeVisible();

  const replay = await page.request.post(request.url(), { data: request.postDataJSON(), headers: {} });
  expect(replay.status()).toBe(403);
});

test('AC-INT-001-12 an agent batch is resolved one proposal at a time with its author visible and no accept-all; a system package only whole', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Agent batch');
  const { batchId, proposals } = await agentBatch(person, projectId, [
    decisionProposal('Guests see the catalog', 'Guests can see the catalog but not sign up.'),
    decisionProposal('Full activities say Full', 'Full activities say “Full” instead of “0 places left”.'),
    decisionProposal('Weather for outdoor activities', 'Outdoor activities show the forecast for their day.'),
  ]);
  await assessed(person, projectId, batchId);
  await page.goto(`/p/${projectId}/batches/${batchId}`);

  await expect(page.getByRole('heading', { level: 1 })).toContainText('claude-code');
  await expect(page.getByRole('main').getByRole('img', { name: 'Agent · claude-code' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /accept all/i })).toHaveCount(0);
  const card = page.getByRole('article', { name: /Proposal 1 of 3/ });
  await expect(card).toContainText('Guests see the catalog');
  await expect(page.getByRole('article')).toHaveCount(1);

  // 1: accepted, with its effect in words before confirming.
  await card.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Guests see the catalog');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Accept' }).click();
  await expect(card.getByText('Accepted', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Next' }).click();

  // 2: rejected with a reason.
  const second = page.getByRole('article', { name: /Proposal 2 of 3/ });
  await expect(second).toContainText('Full activities say Full');
  await second.getByRole('button', { name: 'Reject', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('We keep the number: it tells how full it is.');
  await page.getByRole('dialog').getByRole('button', { name: 'Reject' }).click();
  await expect(second.getByText('Rejected', { exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Next' }).click();

  // 3: changed by the person, then accepted with the edits.
  const third = page.getByRole('article', { name: /Proposal 3 of 3/ });
  await third.getByRole('button', { name: 'Change', exact: true }).click();
  await third.getByLabel('Title').fill('Weather only for outdoor activities');
  await third.getByRole('button', { name: 'Accept my version' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Accept my version' }).click();
  await expect(third.getByText('Accepted with edits', { exact: true })).toBeVisible();

  const batch = await person.get<Batch>(`/api/projects/${projectId}/batches/${batchId}`);
  expect(batch.proposals.map((p) => p.state)).toEqual(['accepted', 'rejected', 'accepted_edited']);
  expect(proposals).toHaveLength(3);
  await expectAccessible(page, 'an agent batch');

  // A DEMIURGO package: accepted or rejected whole, never one proposal of it.
  const d = await decision(person, projectId, 'Members sign up for activities', 'Members sign up in one step.');
  const packageId = await designPackage(person, projectId, d);
  await page.goto(`/p/${projectId}/batches/${packageId}`);
  await expect(page.getByRole('button', { name: 'Accept package' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reject package' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /accept all/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Accept and approve' }).click();
  const both = page.getByRole('alertdialog');
  await expect(both).toContainText('Two things happen');
  await expect(both).toContainText('You approve it: it becomes the current version.');
  await both.getByRole('button', { name: 'Accept and approve' }).click();
  await expect(page.getByText('Accepted', { exact: true }).first()).toBeVisible();
  const pkg = await person.get<Batch>(`/api/projects/${projectId}/batches/${packageId}`);
  expect(pkg.state).toBe('accepted');
  expect((pkg.proposals[0]?.resolution?.effect as { approved?: boolean } | undefined)?.approved).toBe(true);
});

test('AC-INT-001-13 a proposal based on a version shows Out of date with the record and the version it started from, and no accept', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('Out of date');
  const d = await decision(person, projectId, 'Activities have places', 'Each activity has a limit of places.');
  const dep = { type: 'record', id: d.recordId, code: d.code, version: 1 };
  const { batchId } = await agentBatch(person, projectId, [
    { ...decisionProposal('Full activities say Full', 'Full activities say “Full”.'), dependencies: [dep] },
    decisionProposal('Guests see the catalog', 'Guests can see the catalog but not sign up.'),
  ]);
  await page.goto(`/p/${projectId}/batches/${batchId}`);
  const card = page.getByRole('article', { name: /Proposal 1 of 2/ });
  await expect(card.getByRole('button', { name: 'Accept', exact: true })).toBeVisible();

  // A new version of the record it depends on is approved: the proposal goes out of date, live.
  await newApprovedVersion(person, projectId, d, 'Each activity has a limit of places, and a waiting list.');
  const stale = card.locator('[data-out-of-date]');
  await expect(stale).toContainText('Out of date');
  await expect(stale).toContainText(d.code);
  await expect(stale).toContainText('v1');
  await expect(card.getByRole('button', { name: /^Accept/ })).toHaveCount(0);
  await expect(card.locator('[data-mark="stale"]').first()).toBeVisible();
  await expectAccessible(page, 'an out-of-date proposal');
});

test('screens of cut 1: the package before ratifying, the confirmation, an out-of-date package, a DEMIURGO package and an agent batch', async ({
  page,
  person,
}) => {
  const projectId = await person.createProject('DEMIURGO');
  const first = await person.importDesign(projectId);
  await page.goto(`/p/${projectId}/batches/${first.batchId}`);
  await expect(page.getByRole('table', { name: "What's inside" })).toBeVisible();
  await screenshot(page, 1, '01-package-before-ratifying');
  await page.getByRole('region', { name: 'Documents' }).getByRole('button', { name: /Open/ }).nth(1).click();
  await page.mouse.wheel(0, 500);
  await screenshot(page, 1, '02-package-document-open');
  await page.mouse.wheel(0, -2000);
  await page.getByRole('button', { name: 'Ratify', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await screenshot(page, 1, '03-ratify-confirmation');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Not now' }).click();

  // A newer import replaces the pending one.
  const tree = await designTree();
  const fdr = tree['fdr/FDR-INT-001.md'] ?? '';
  tree['fdr/FDR-INT-001.md'] = fdr.replace('sin usar la API a mano', 'sin usar nunca la API a mano');
  await person.command(projectId, 'design.import', { tree, origin: 'design' });
  await page.goto(`/p/${projectId}/batches/${first.batchId}`);
  await expect(page.getByText('Out of date: a newer import replaced it')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ratify', exact: true })).toHaveCount(0);
  await expectAccessible(page, 'an out-of-date package');
  await screenshot(page, 1, '04-package-out-of-date');

  const other = await person.createProject('Club Activities');
  const d = await decision(person, other, 'Members sign up for activities', 'Members sign up for an activity in one step.');
  const packageId = await designPackage(person, other, d);
  await page.goto(`/p/${other}/batches/${packageId}`);
  await expect(page.getByRole('button', { name: 'Accept package' })).toBeVisible();
  await expectAccessible(page, 'a DEMIURGO package');
  await screenshot(page, 1, '05-demiurgo-package');

  const { batchId } = await agentBatch(person, other, [
    decisionProposal('Full activities say Full', 'Full activities say “Full” instead of “0 places left”.'),
    decisionProposal('Members sign up for activities in one step', 'Members sign up for an activity in one step.'),
    decisionProposal('Weather for outdoor activities', 'Outdoor activities show the forecast for their day.'),
  ]);
  await assessed(person, other, batchId);
  await page.goto(`/p/${other}/batches/${batchId}`);
  await expect(page.getByRole('article', { name: /Proposal 1 of 3/ })).toBeVisible();
  await screenshot(page, 1, '06-agent-batch-one-at-a-time');
  await page.getByRole('article').getByRole('button', { name: 'Change', exact: true }).click();
  await screenshot(page, 1, '07-agent-batch-change');
});
