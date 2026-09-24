// Data for the package and Needs you walks, prepared with commands through the API (the same path
// as walkthrough-s1): decisions, agent batches with a token, a DEMIURGO package and the knowledge
// items (classifications, failed updates and conflicts) the simulated classifier produces.

import type { Locator, Page } from '@playwright/test';
import type { AgentApi, PersonApi } from './support/fixtures.ts';

/** Moves the focus with Tab alone until it reaches the element (keyboard-only walks). */
export async function tabTo(page: Page, target: Locator, max = 60, back = false): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
  }
  throw new Error(`Tab never reached ${String(target)}.`);
}

export type Created = { recordId: string; code: string; versionId: string; version: number };

export function decisionData(title: string, text: string, domain = 'producto') {
  return {
    type: 'decision',
    domain,
    title,
    sections: [
      { title: 'Context', content: text },
      { title: 'Decision', content: text },
      { title: 'Consequences', content: 'Nothing else changes.' },
    ],
  };
}

/** A decision created by the person, approved or left as a draft. */
export async function decision(
  person: PersonApi,
  projectId: string,
  title: string,
  text: string,
  approve = true,
): Promise<Created> {
  const r = await person.command<Created>(projectId, 'record.create', decisionData(title, text));
  if (!r.result) throw new Error('record.create returned nothing.');
  if (approve) await person.command(projectId, 'record_version.approve', {}, r.result.versionId);
  return r.result;
}

/** A new version of a decision, approved: whatever depended on the previous one goes out of date. */
export async function newApprovedVersion(person: PersonApi, projectId: string, d: Created, text: string): Promise<string> {
  const { type: _t, domain: _d, ...content } = decisionData(text.slice(0, 60), text);
  const v = await person.command<{ versionId: string }>(projectId, 'record_version.create', {
    record_id: d.recordId,
    ...content,
    change_note: 'A newer take.',
  });
  await person.command(projectId, 'record_version.approve', {}, v.entity_id);
  return v.entity_id;
}

/** Waits until the knowledge has taken in every change (the durable engine works in the background). */
export async function knowledgeSettled(person: PersonApi, projectId: string): Promise<void> {
  await person.until<{ up_to_date: boolean; updates_in_progress: number }>(
    `/api/projects/${projectId}/knowledge`,
    (k) => k.up_to_date && k.updates_in_progress === 0,
  );
}

export type ProposalInput = { type: string; payload: Record<string, unknown>; dependencies?: unknown[] };

export function decisionProposal(title: string, decisionText: string): ProposalInput {
  return {
    type: 'decision',
    payload: {
      title,
      context: `While building: ${title.toLowerCase()}.`,
      decision: decisionText,
      consequences: 'A small change.',
    },
  };
}

/** A batch of an external agent (claude-code) through its token. */
export async function agentBatch(
  person: PersonApi,
  projectId: string,
  proposals: ProposalInput[],
  summary = 'Ideas while building the catalog.',
): Promise<{ batchId: string; proposals: string[]; agent: AgentApi }> {
  const agent = await person.agent(projectId);
  const r = await agent.command<{ batchId: string; proposals: string[] }>('batch.submit', { summary, proposals });
  if (!r.result) throw new Error('batch.submit returned nothing.');
  return { ...r.result, agent };
}

type InboxShape = { batches: { id: string; type: string; proposals: { assessment: { pending?: boolean } | null }[] }[] };

/** Waits until the idea check of every proposal of a batch is recorded. */
export async function assessed(person: PersonApi, projectId: string, batchId: string): Promise<void> {
  await person.until<InboxShape>(`/api/projects/${projectId}/inbox`, (i) =>
    i.batches.some((b) => b.id === batchId && b.proposals.every((p) => !p.assessment?.pending)),
  );
}

/** A DEMIURGO package (design_proposal) from an approved decision. */
export async function designPackage(person: PersonApi, projectId: string, d: Created): Promise<string> {
  await knowledgeSettled(person, projectId);
  await person.command(projectId, 'run.request', {
    action: 'design_proposal',
    scope: { type: 'record_version', id: d.versionId },
  });
  const inbox = await person.until<InboxShape>(`/api/projects/${projectId}/inbox`, (i) =>
    i.batches.some((b) => b.type === 'system_package'),
  );
  const pkg = inbox.batches.find((b) => b.type === 'system_package');
  if (!pkg) throw new Error('The DEMIURGO package never arrived.');
  await assessed(person, projectId, pkg.id);
  return pkg.id;
}

/** A taxonomy with one axis whose categories match nothing about activities: approvals get held for review. */
export async function approvedTaxonomy(person: PersonApi, projectId: string): Promise<string> {
  const t = await person.command(projectId, 'taxonomy.propose', {
    code: 'TAX-001',
    title: 'Areas of the product',
    axes: [
      {
        code: 'area',
        name: 'Area',
        categories: [
          { code: 'billing', name: 'Billing', description: 'Invoices, payments and refunds.' },
          { code: 'reports', name: 'Reports', description: 'Charts and exports for the board.' },
          { code: 'other', name: 'Other', description: 'Nothing fits.' },
        ],
      },
    ],
    sections: [{ title: 'Purpose', content: 'Where each thing lives.' }],
  });
  await person.command(projectId, 'taxonomy.approve', {}, t.entity_id);
  return t.entity_id;
}

export type Thread = { exploration: string; assumed: string; open: string };

/**
 * A thread with an assumed question (DEMIURGO asks, then infers it from "I decide …") and an open one.
 * The chat also leaves a DEMIURGO batch with the decision it heard.
 */
export async function threadWithQuestions(person: PersonApi, projectId: string, purpose: string): Promise<Thread> {
  const e = await person.command(projectId, 'exploration.open', { purpose });
  await person.command(projectId, 'message.post', { exploration_id: e.entity_id, text: 'Members sign up for activities.' });
  type Detail = { questions: { id: string; state: string; question: string }[] };
  await person.until<Detail>(`/api/projects/${projectId}/explorations/${e.entity_id}`, (x) =>
    x.questions.some((q) => q.state === 'pending'),
  );
  await person.command(projectId, 'message.post', {
    exploration_id: e.entity_id,
    text: "I decide we'll confirm each sign-up by email.",
  });
  const x = await person.until<Detail>(`/api/projects/${projectId}/explorations/${e.entity_id}`, (v) =>
    v.questions.some((q) => q.state === 'inferred'),
  );
  const assumed = x.questions.find((q) => q.state === 'inferred')?.id ?? '';
  const open = await person.command(projectId, 'question.raise', {
    exploration_id: e.entity_id,
    question: 'Can guests sign up without an account?',
  });
  return { exploration: e.entity_id, assumed, open: open.entity_id };
}

export type Inbox = {
  total: number;
  batches: { id: string; type: string; producer: string; proposals: { id: string; type: string; state: string }[] }[];
  questions_to_confirm: { id: string }[];
  open_questions: { id: string }[];
  versions_to_approve: { id: string; code: string; n: number }[];
  links_under_review: { id: string; from_code: string; to_code: string }[];
  classifications_to_review: { id: string; node_ref: string }[];
  rejected_updates: { id: string }[];
};

export const inboxOf = (person: PersonApi, projectId: string) => person.get<Inbox>(`/api/projects/${projectId}/inbox`);

type Knowledge = { up_to_date: boolean; updates_in_progress: number; updates: { id: string; state: string }[] };

/**
 * A knowledge update that failed. The E2E classifier fails the first three calls with the same
 * input, so the text is unique per test; it is retried twice here, so the person's retry works.
 * Its text matches a category of the taxonomy: once taken in, nothing is held for review.
 */
export async function failedUpdate(person: PersonApi, projectId: string): Promise<string> {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await decision(
    person,
    projectId,
    `Billing refunds ${unique} [classifier-fails]`,
    'Invoices, payments and refunds for billing.',
  );
  const inbox = await person.until<Inbox>(`/api/projects/${projectId}/inbox`, (i) => i.rejected_updates.length > 0);
  const id = inbox.rejected_updates[0]?.id ?? '';
  for (let i = 0; i < 2; i++) {
    await person.command(projectId, 'knowledge_update.retry', {}, id);
    await person.until<Knowledge>(
      `/api/projects/${projectId}/knowledge`,
      (k) => k.updates_in_progress === 0 && k.updates.find((u) => u.id === id)?.state === 'rejected',
    );
  }
  return id;
}

/** Two approved decisions that say opposite things: knowledge proposes to review the first. */
export async function conflict(
  person: PersonApi,
  projectId: string,
  topic: string,
): Promise<{ first: Created; second: Created }> {
  const first = await decision(person, projectId, `Organizers publish ${topic}`, `Organizers publish ${topic} every week.`);
  await knowledgeSettled(person, projectId);
  const second = await decision(
    person,
    projectId,
    `Organizers never publish ${topic}`,
    `Organizers never publish ${topic} every week.`,
  );
  await person.until<Inbox>(`/api/projects/${projectId}/inbox`, (i) => i.batches.some((b) => b.type === 'knowledge'));
  return { first, second };
}

/**
 * One thing of each kind in Needs you: a conflict, an assumed and an open question, an agent batch
 * (and DEMIURGO's from the conversation), a version to approve, a link to review, classifications to
 * review and a knowledge update that failed.
 */
export async function everyKind(person: PersonApi, projectId: string): Promise<Inbox> {
  await approvedTaxonomy(person, projectId);
  await knowledgeSettled(person, projectId);
  await failedUpdate(person, projectId);
  const a = await decision(
    person,
    projectId,
    'Members sign up for activities',
    'Members can sign up for activities in one step.',
  );
  await knowledgeSettled(person, projectId);
  await decision(person, projectId, 'Members never sign up for activities', 'Members cannot sign up for activities in one step.');
  await knowledgeSettled(person, projectId);
  await person.command(projectId, 'record.create', {
    type: 'fdr',
    domain: 'producto',
    title: 'Sign up for an activity',
    sections: [
      { title: 'Goal', content: 'A member takes a place in one step.' },
      { title: 'Scope', content: 'Upcoming activities with places left.' },
      { title: 'Out of scope', content: 'Payments and waiting lists.' },
      { title: 'Behavior', content: 'The member opens an activity and takes a place.' },
    ],
    criteria: [
      {
        carry: 'new',
        title: 'Takes a place',
        statement: 'When a member takes a place, then the activity shows one place less.',
        verification: 'automatic',
        check: 'An end-to-end test signs up and checks the places.',
      },
    ],
    links: [{ type: 'based_on', target: { code: a.code, version: 1 } }],
  });
  await newApprovedVersion(person, projectId, a, 'Members can sign up for activities in two steps.');
  const { batchId } = await agentBatch(person, projectId, [
    decisionProposal('Guests see the catalog', 'Guests can see the catalog but not sign up.'),
  ]);
  await threadWithQuestions(person, projectId, 'How members sign up');
  await knowledgeSettled(person, projectId);
  await assessed(person, projectId, batchId);
  return person.until<Inbox>(
    `/api/projects/${projectId}/inbox`,
    (i) =>
      i.batches.some((b) => b.type === 'knowledge') &&
      i.batches.some((b) => b.producer.startsWith('agent:run:')) &&
      i.links_under_review.length > 0 &&
      i.classifications_to_review.length > 0 &&
      i.rejected_updates.length > 0,
  );
}
