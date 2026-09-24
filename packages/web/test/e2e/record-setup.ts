// Data for the product, record, new-version and lens specs, prepared with commands through the API
// (the same path as walkthrough-s1): a ratified import of design/, and records built by hand.

import type { Page } from '@playwright/test';
import type { RecordDetail, Readiness } from '../../src/api/types.ts';
import type { PersonApi } from './support/fixtures.ts';

/** A person who already folded the legend (it stays in its ⓘ): the screenshots show the screen itself. */
export async function foldLegend(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('demiurgo:legend', JSON.stringify({ dismissed: true, seen: [] }));
    } catch {
      // about:blank has no storage.
    }
  });
}

/** A project with the repository's design/ imported and ratified: every record is a draft. */
export async function ratifiedProject(person: PersonApi, name: string): Promise<string> {
  const projectId = await person.createProject(name);
  const { batchId } = await person.importDesign(projectId);
  await person.command(projectId, 'batch.accept_package', {}, batchId);
  return projectId;
}

export function recordOf(person: PersonApi, projectId: string, code: string): Promise<RecordDetail> {
  return person.get<RecordDetail>(`/api/projects/${projectId}/records/${code}`);
}

export function readinessOf(person: PersonApi, projectId: string, versionId: string): Promise<Readiness> {
  return person.get<Readiness>(`/api/projects/${projectId}/versions/${versionId}/readiness`);
}

type Created = { recordId: string; code: string; versionId: string };

export async function createDecision(
  person: PersonApi,
  projectId: string,
  title: string,
  options: { approve?: boolean; domain?: string } = {},
): Promise<Created> {
  const r = await person.command<Created>(projectId, 'record.create', {
    type: 'decision',
    domain: options.domain ?? 'events',
    title,
    sections: [
      { title: 'Context', content: 'Members bring friends to open activities.' },
      { title: 'Decision', content: `${title}.` },
      { title: 'Consequences', content: 'Invitations are counted per activity.' },
    ],
  });
  if (!r.result) throw new Error('record.create returned nothing');
  if (options.approve) await person.command(projectId, 'record_version.approve', {}, r.result.versionId);
  return r.result;
}

export type CheckInput = { title: string; statement: string; verification: 'automatic' | 'manual'; check: string };

export const CHECKS: CheckInput[] = [
  {
    title: 'Upcoming only',
    statement: 'When a member opens Activities, then they see only upcoming activities, the soonest first.',
    verification: 'automatic',
    check: 'An end-to-end test opens Activities and checks the order.',
  },
  {
    title: 'Places left',
    statement: 'When a member opens an activity, then it shows its date, its place and the places left.',
    verification: 'automatic',
    check: 'A test opens an activity and reads the three fields.',
  },
  {
    title: 'Shows up at once',
    statement: 'When an organizer publishes an activity, then members see it in the catalog.',
    verification: 'manual',
    check: 'You publish one and look at the catalog.',
  },
];

export async function createFeature(
  person: PersonApi,
  projectId: string,
  title: string,
  options: {
    basedOn?: { code: string; version: number };
    criteria?: CheckInput[];
    origin?: { type: string; id: string };
    domain?: string;
    approve?: boolean;
  } = {},
): Promise<Created> {
  const r = await person.command<Created>(projectId, 'record.create', {
    type: 'fdr',
    domain: options.domain ?? 'catalog',
    title,
    sections: [
      { title: 'Goal', content: 'Members see every upcoming activity in one place.' },
      { title: 'Scope', content: '- The list of activities\n- The page of one activity' },
      { title: 'Out of scope', content: 'Signing up, waiting lists and paying.' },
      { title: 'Behavior', content: 'An organizer publishes an activity and **members** see it in the catalog.' },
    ],
    criteria: (options.criteria ?? CHECKS).map((c) => ({ carry: 'new', ...c })),
    links: options.basedOn ? [{ type: 'based_on', target: options.basedOn }] : [],
    ...(options.origin ? { origin: options.origin } : {}),
  });
  if (!r.result) throw new Error('record.create returned nothing');
  if (options.approve) await person.command(projectId, 'record_version.approve', {}, r.result.versionId);
  return r.result;
}

/** Waits until the knowledge has caught up with every authority event (it runs in the background). */
export async function settled(person: PersonApi, projectId: string): Promise<void> {
  await person.until<{ up_to_date: boolean; updates_in_progress: number }>(
    `/api/projects/${projectId}/knowledge`,
    (k) => k.up_to_date && k.updates_in_progress === 0,
    60_000,
  );
}
