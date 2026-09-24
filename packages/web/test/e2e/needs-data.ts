// Data for the package and Needs you walks, prepared with commands through the API (the same path
// as walkthrough-s1): decisions, agent batches with a token, a DEMIURGO package and the knowledge
// items (classifications, failed updates and conflicts) the simulated classifier produces.

import type { AgentApi, PersonApi } from './support/fixtures.ts';

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
