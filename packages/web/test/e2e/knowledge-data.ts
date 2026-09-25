// Data for the knowledge, sources and origins walks, prepared with commands through the API (the
// same path as walkthrough-s1): a ratified design/, an idea from an external agent, and a thread
// that ends in a decision and the feature drafted from it.

import type { Inbox, Knowledge, ProductState, RecordDetail, Taxonomy } from '../../src/api/types.ts';
import type { PersonApi } from './support/fixtures.ts';

const api = (projectId: string, path: string) => `/api/projects/${projectId}${path}`;

/** A project with design/ imported and ratified: every record is proposed and TAX-001 is a draft. */
export async function ratifiedProject(person: PersonApi, name: string): Promise<string> {
  const projectId = await person.createProject(name);
  const { batchId } = await person.importDesign(projectId);
  await person.command(projectId, 'batch.accept_package', {}, batchId);
  return projectId;
}

/** Waits until every knowledge update has finished (the durable engine works in the background). */
export function settled(person: PersonApi, projectId: string, timeout = 90_000): Promise<Knowledge> {
  return person.until<Knowledge>(
    api(projectId, '/knowledge'),
    (k) => k.up_to_date && k.updates_in_progress === 0 && k.updates.every((u) => ['applied', 'rejected'].includes(u.state)),
    timeout,
  );
}

export async function approveTaxonomy(person: PersonApi, projectId: string): Promise<Taxonomy> {
  const [taxonomy] = await person.get<Taxonomy[]>(api(projectId, '/taxonomies'));
  if (!taxonomy) throw new Error('There is no taxonomy to approve.');
  await person.command(projectId, 'taxonomy.approve', {}, taxonomy.id);
  return taxonomy;
}

export async function approveRecord(person: PersonApi, projectId: string, code: string): Promise<void> {
  const record = await person.get<RecordDetail>(api(projectId, `/records/${code}`));
  const draft = record.versions.find((v) => v.state === 'draft');
  if (draft) await person.command(projectId, 'record_version.approve', {}, draft.id);
}

/** The text of a record's version as the knowledge keeps it: its sections, one after another. */
async function recordText(person: PersonApi, projectId: string, code: string): Promise<{ title: string; text: string }> {
  const record = await person.get<RecordDetail>(api(projectId, `/records/${code}`));
  const v = record.versions[0];
  if (!v) throw new Error(`${code} has no version.`);
  return { title: v.title, text: v.sections.map((s) => `${s.title}: ${s.content}`).join('\n') };
}

const WITHOUT_NEGATIONS = /\b(no|nunca|sin|ningun\w*|ninguna|prohib\w*|impide\w*|not|never|without|none)\b/gi;

/**
 * An external agent proposes two decisions that the simulated classifier (lexical) finds against
 * the imported design: one that says again what DEC-PLN-001 says (it duplicates it), and one that
 * takes the words of ADR-AGE-001 without any of its negations (it contradicts it).
 */
export async function agentIdeas(
  person: PersonApi,
  projectId: string,
): Promise<{ batchId: string; duplicate: string; contradiction: string }> {
  const plan = await recordText(person, projectId, 'DEC-PLN-001');
  const agents = await recordText(person, projectId, 'ADR-AGE-001');
  const duplicate = `${plan.title} (otra vez)`;
  const contradiction = 'Los agentes por CLI, con suscripción y con todo permitido';
  const agent = await person.agent(projectId);
  const submitted = await agent.command('batch.submit', {
    proposals: [
      {
        type: 'decision',
        payload: {
          title: duplicate,
          context: 'Un agente lo propone de nuevo.',
          decision: plan.text.slice(0, 1500),
          consequences: 'Las mismas.',
        },
      },
      {
        type: 'decision',
        payload: {
          title: contradiction,
          context: 'Propuesta.',
          decision: `${agents.title}. ${agents.text.slice(0, 400)}`.replace(WITHOUT_NEGATIONS, ''),
          consequences: 'Los agentes pueden hacer cualquier cosa.',
        },
      },
    ],
  });
  const batchId = submitted.entity_id;
  await person.until<{ proposal: { batch_id: string }; findings: unknown[] }[]>(
    api(projectId, '/knowledge/idea-assessments'),
    (list) => list.filter((a) => a.proposal.batch_id === batchId && a.findings.length > 0).length === 2,
    60_000,
  );
  return { batchId, duplicate, contradiction };
}

/**
 * A thread about sign-ups: the person decides in it, DEMIURGO proposes the decision (accepted and
 * approved by the person), drafts a feature from it (accepted by the person) and the thread is
 * concluded with its conclusion.
 */
export async function threadToFeature(person: PersonApi, projectId: string) {
  const purpose = 'Sign-ups for club activities';
  const conclusion = 'Signing up is instant: members never wait for an approval.';
  const thread = await person.command(projectId, 'exploration.open', { purpose });
  await person.command(projectId, 'message.post', {
    exploration_id: thread.entity_id,
    text: "Let's go with instant sign-up for members, without an approval step.",
  });
  const inbox = await person.until<Inbox>(api(projectId, '/inbox'), (b) =>
    b.batches.some((x) => x.proposals.some((p) => p.type === 'decision')),
  );
  const proposal = inbox.batches.flatMap((b) => b.proposals).find((p) => p.type === 'decision');
  const accepted = await person.command<{ code: string; versionId: string }>(
    projectId,
    'proposal.accept',
    { approve: true },
    proposal?.id,
  );
  const decision = accepted.result;
  if (!decision) throw new Error('Accepting the decision returned nothing.');
  await settled(person, projectId);
  await person.command(projectId, 'run.request', {
    action: 'design_proposal',
    scope: { type: 'record_version', id: decision.versionId },
  });
  const drafted = await person.until<Inbox>(api(projectId, '/inbox'), (b) => b.batches.some((x) => x.type === 'system_package'));
  const pkg = drafted.batches.find((x) => x.type === 'system_package');
  await person.command(projectId, 'batch.accept_package', {}, pkg?.id);
  await person.command(projectId, 'exploration.conclude', { reason: conclusion }, thread.entity_id);
  const state = await person.until<ProductState>(api(projectId, '/state'), (s) => s.designs.some((d) => d.origin_exploration));
  const feature = state.designs.find((d) => d.origin_exploration === thread.entity_id);
  return {
    threadId: thread.entity_id,
    purpose,
    conclusion,
    decision: state.decisions.find((d) => d.code === decision.code),
    feature,
  };
}
