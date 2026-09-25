// The UI's dictionary (spec §6): state and command codes → words and marks. The labels of
// /api/tables are the default word; this dictionary adds the mark and changes the word only where
// the agreed language differs. Record prose is shown as it was written, never translated.

import type { Actor, RecordType } from './api/types.ts';

/** Marks of the visual language (canvas S3A): dots, not-active marks and colors. */
export type MarkKind =
  | 'confirmed'
  | 'assumed'
  | 'proposed'
  | 'open'
  | 'unknown'
  | 'parked'
  | 'dropped'
  | 'replaced'
  | 'stale'
  | 'conflict'
  | 'problem'
  | 'working'
  | 'inactive'
  | 'done';

/** Name and phrase of each mark: the tooltip and the legend say the same thing. */
export const MARKS: Record<MarkKind, { name: string; phrase: string }> = {
  confirmed: { name: 'Confirmed', phrase: 'A person said yes.' },
  assumed: { name: 'Assumed', phrase: 'DEMIURGO concluded it. Not confirmed yet.' },
  proposed: { name: 'Proposed', phrase: 'Suggested, waiting for you.' },
  open: { name: 'Open', phrase: 'Asked, no answer yet.' },
  unknown: { name: 'Unknown', phrase: 'Not known yet.' },
  parked: { name: 'Parked', phrase: 'Kept for later.' },
  dropped: { name: 'Dropped', phrase: "Doesn't apply." },
  replaced: { name: 'Replaced', phrase: 'A newer version exists.' },
  stale: { name: 'Out of date', phrase: 'What it was based on changed: it can no longer be accepted.' },
  conflict: { name: 'Conflict', phrase: 'Contradicts something confirmed.' },
  problem: { name: 'Problem', phrase: 'Something went wrong or needs a review.' },
  working: { name: 'Working', phrase: 'DEMIURGO or an agent is on it.' },
  inactive: { name: 'Not active', phrase: 'Finished or stopped: nothing to do.' },
  done: { name: 'Done', phrase: 'Finished without problems.' },
};

export type Word = { word: string; mark: MarkKind };

/** Entities the UI shows, with every state of their table (a unit test checks it's complete). */
export const STATE_WORDS: Record<string, Record<string, Word>> = {
  record_version: {
    draft: { word: 'Draft', mark: 'proposed' },
    approved: { word: 'Approved', mark: 'confirmed' },
    superseded: { word: 'Replaced', mark: 'replaced' },
    discarded: { word: 'Discarded', mark: 'dropped' },
  },
  question: {
    pending: { word: 'Open', mark: 'open' },
    inferred: { word: 'Assumed', mark: 'assumed' },
    confirmed: { word: 'Confirmed', mark: 'confirmed' },
    postponed: { word: 'Parked', mark: 'parked' },
    discarded: { word: 'Dropped', mark: 'dropped' },
  },
  proposal: {
    pending: { word: 'Proposed', mark: 'proposed' },
    accepted: { word: 'Accepted', mark: 'confirmed' },
    accepted_edited: { word: 'Accepted with edits', mark: 'confirmed' },
    rejected: { word: 'Rejected', mark: 'dropped' },
    superseded: { word: 'Out of date', mark: 'stale' },
  },
  batch: {
    pending: { word: 'Pending', mark: 'proposed' },
    accepted: { word: 'Accepted', mark: 'confirmed' },
    rejected: { word: 'Rejected', mark: 'dropped' },
    resolved: { word: 'Resolved', mark: 'done' },
    superseded: { word: 'Out of date', mark: 'stale' },
  },
  link: {
    current: { word: 'Current', mark: 'confirmed' },
    needs_review: { word: 'Needs review', mark: 'problem' },
    kept: { word: 'Kept', mark: 'confirmed' },
    changed: { word: 'Changed', mark: 'confirmed' },
    obsolete: { word: 'Out of date', mark: 'stale' },
  },
  ai_run: {
    queued: { word: 'Queued', mark: 'working' },
    running: { word: 'Working', mark: 'working' },
    completed: { word: 'Completed', mark: 'done' },
    failed: { word: 'Failed', mark: 'problem' },
    cancelled: { word: 'Cancelled', mark: 'inactive' },
    interrupted: { word: 'Interrupted', mark: 'problem' },
  },
  knowledge_update: {
    queued: { word: 'Updating', mark: 'working' },
    classifying: { word: 'Updating', mark: 'working' },
    verifying: { word: 'Updating', mark: 'working' },
    applied: { word: 'Applied', mark: 'done' },
    rejected: { word: 'Failed', mark: 'problem' },
  },
  classification: {
    applied: { word: 'Applied', mark: 'confirmed' },
    pending_review: { word: 'Needs review', mark: 'proposed' },
    resolved: { word: 'Resolved', mark: 'confirmed' },
  },
  exploration: {
    active: { word: 'Active', mark: 'open' },
    concluded: { word: 'Concluded', mark: 'confirmed' },
    set_aside: { word: 'Set aside', mark: 'parked' },
  },
  taxonomy: {
    draft: { word: 'Proposed', mark: 'proposed' },
    approved: { word: 'Approved', mark: 'confirmed' },
    superseded: { word: 'Replaced', mark: 'replaced' },
  },
  knowledge_node: {
    current: { word: 'Current', mark: 'done' },
    invalidated: { word: 'Invalidated', mark: 'inactive' },
  },
  knowledge_edge: {
    current: { word: 'Current', mark: 'done' },
    invalidated: { word: 'Invalidated', mark: 'inactive' },
  },
  source: {
    registered: { word: 'Registered', mark: 'unknown' },
  },
};

/** Observation types of DEMIURGO's messages. */
export const OBSERVATION_WORDS: Record<string, Word> = {
  claim: { word: 'Claim', mark: 'proposed' },
  hypothesis: { word: 'Hypothesis', mark: 'proposed' },
  unknown: { word: 'Unknown', mark: 'unknown' },
};

/** Epistemic status of the API → mark (FDR-DIS-001 correspondence). */
export const EPISTEMIC_MARK: Record<string, MarkKind> = {
  confirmed: 'confirmed',
  proposed: 'proposed',
  pending: 'open',
  unknown: 'unknown',
};

export function stateWord(entity: string, state: string, fallbackLabel?: string): Word {
  return STATE_WORDS[entity]?.[state] ?? { word: fallbackLabel ?? state, mark: 'unknown' };
}

/** Words of the commands a person runs from the UI. */
export const COMMAND_WORDS: Record<string, string> = {
  'batch.accept_package': 'Accept package',
  'batch.reject_package': 'Reject package',
  'proposal.accept': 'Accept',
  'proposal.accept_edited': 'Change',
  'proposal.reject': 'Reject',
  'record_version.approve': 'Approve',
  'record_version.discard': 'Discard',
  'record_version.create': 'New version',
  'question.confirm': 'Confirm',
  'question.postpone': 'Park',
  'question.discard': 'Drop',
  'question.reopen': 'Reopen',
  'question.raise': 'Ask a question',
  'link.create': 'Add a link',
  'exploration.open': 'New thread',
  'exploration.conclude': 'Conclude',
  'exploration.set_aside': 'Set aside',
  'exploration.resume': 'Resume',
  'message.post': 'Send',
  'run.request': 'Ask DEMIURGO',
  'run.retry': 'Retry',
  'run.cancel': 'Cancel',
  'link.keep': 'Keep',
  'link.change': 'Mark as changed',
  'link.obsolete': 'Out of date',
  'classification.resolve': 'Resolve',
  'knowledge_update.retry': 'Retry',
  'taxonomy.propose': 'Propose',
  'taxonomy.approve': 'Approve',
  'source.register': 'Add a source',
  'design.import': 'Import design/',
};

export function commandWord(command: string): string {
  return COMMAND_WORDS[command] ?? command;
}

/** Names of the UI for the back's record types (spec §6, "Nombres"). */
export const TYPE_WORDS: Record<RecordType, string> = {
  fdr: 'Feature',
  adr: 'Tech decision',
  decision: 'Decision',
  bug: 'Bug',
  requirement: 'Requirement',
  quality_requirement: 'Quality requirement',
  threat_model: 'Threat model',
  production_readiness: 'Production readiness',
};

export const TYPE_WORDS_PLURAL: Record<RecordType, string> = {
  fdr: 'Features',
  adr: 'Tech decisions',
  decision: 'Decisions',
  bug: 'Bugs',
  requirement: 'Requirements',
  quality_requirement: 'Quality requirements',
  threat_model: 'Threat models',
  production_readiness: 'Production readiness',
};

/** Failure kinds of a run, in product words. */
export const FAILURE_WORDS: Record<string, string> = {
  invalid_output: "It couldn't finish: the output didn't match the format. Nothing was changed.",
  agent_error: 'The agent answered with an error. Nothing was changed.',
  timeout: 'It took too long and was stopped. Nothing was changed.',
  infra: 'DEMIURGO restarted while it was running. Nothing was changed.',
  cancelled: 'You cancelled it. Nothing was changed.',
  stale_knowledge: 'The knowledge changed while it was running. Nothing was changed.',
};

export function failureWord(kind: string | null, state?: string): string {
  if (state === 'interrupted') return 'DEMIURGO restarted while it was running. Nothing was changed.';
  if (!kind) return 'It stopped without saying why. Nothing was changed.';
  return FAILURE_WORDS[kind] ?? 'It stopped with an error. Nothing was changed.';
}

export const ACTION_WORDS: Record<string, string> = {
  exploration_chat: 'Conversation',
  design_proposal: 'Draft',
  echo: 'Echo',
};

/** Who did something, from the actor of an event or the producer of a batch (spec §6, "Quién"). */
export type Who = { kind: 'you' | 'demiurgo' | 'agent' | 'automatic'; name: string; detail: string };

export function whoOf(actor: string | Actor, model?: string | null): Who {
  const text = typeof actor === 'string' ? actor : formatActor(actor);
  if (text.startsWith('human:')) return { kind: 'you', name: 'You', detail: text.slice(6) };
  if (text.startsWith('agent:run:')) return { kind: 'demiurgo', name: 'DEMIURGO', detail: model ?? '' };
  const agent = /^agent:([^:]+):/.exec(text);
  if (agent?.[1]) return { kind: 'agent', name: agent[1], detail: 'Agent' };
  const s = /^system:([^@]+)@?(.*)$/.exec(text);
  if (s?.[1]) return { kind: 'automatic', name: 'Automatic', detail: `${s[1]}${s[2] ? `@${s[2]}` : ''}` };
  return { kind: 'automatic', name: 'Automatic', detail: text };
}

function formatActor(a: Actor): string {
  switch (a.type) {
    case 'human':
      return `human:${a.person}`;
    case 'agent_external':
      return `agent:${a.name}:${a.session}`;
    case 'agent_run':
      return `agent:run:${a.run}`;
    case 'system':
      return `system:${a.component}@${a.version}`;
  }
}

export const WHO_PHRASES: Record<Who['kind'], string> = {
  you: 'Only people confirm.',
  demiurgo: 'Drafts, asks and proposes.',
  agent: 'From outside. Only proposes.',
  automatic: 'A rule or test that ran alone.',
};

export const PRODUCT_WORDS = {
  needsYou: 'Needs you',
  nothingNeedsYou: 'Nothing needs you. You can close DEMIURGO.',
  readyToBuild: 'Ready to build',
  notReady: 'Not ready',
  notBuilt: 'not built',
  catchingUp: 'DEMIURGO is catching up with your latest changes. Try again in a moment.',
  cantReach: "Can't reach DEMIURGO. Retrying…",
  onlyAPerson: 'Only a person can do this.',
  notAllowed: "This isn't allowed here.",
} as const;
