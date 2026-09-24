// "While you were away" (spec §7.2): one line per thing that has events since the last visit,
// from templates by the kind of thing and its events; which cards changed; and whether anything
// the person confirmed was changed (an event that left an authority state of the tables).

import type { BatchDetail, ChangedThing, Changes, Tables } from '../../../api/types.ts';

export type Segment = string | { strong: string };

export type LensLine = {
  /** kind:key, as the things of the API. */
  id: string;
  kind: ChangedThing['kind'];
  key: string;
  at: string;
  /** Who did the event the line tells. */
  actor: string;
  segments: Segment[];
  /** Codes of the records the line is about, shown small beside it. */
  codes: string[];
  /** A conflict, a failure or a link to review: said in rust. */
  problem: boolean;
  /** Short words for the card of what changed ("Approved v2"). */
  note: string | null;
};

export type LensContext = {
  /** Detail of the batches that changed, once loaded. */
  batches?: Record<string, BatchDetail | undefined>;
  /** Title and checks of the latest version of each record. */
  records?: Record<string, { title: string; checks: number }>;
};

type Event = ChangedThing['events'][number];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isHuman = (actor: string) => actor.startsWith('human:');
const isRun = (actor: string) => actor.startsWith('agent:run:');
const isAgent = (actor: string) => actor.startsWith('agent:') && !isRun(actor);

/** The subject of a sentence for an actor. */
function subject(actor: string): string {
  if (isHuman(actor)) return 'You';
  if (isRun(actor)) return 'DEMIURGO';
  if (isAgent(actor)) return 'An agent';
  return 'DEMIURGO';
}

/** The first event of a thing: the API never sends a thing without events. */
function firstOf(events: Event[]): Event {
  const [e] = events;
  if (!e) throw new Error('A thing without events.');
  return e;
}

const last = (events: Event[], ...commands: string[]) => events.findLast((e) => commands.includes(e.command));
const count = (events: Event[], ...commands: string[]) => events.filter((e) => commands.includes(e.command)).length;

type Told = { event: Event; segments: Segment[]; problem?: boolean; note?: string | null; codes?: string[] };

function recordLine(t: ChangedThing, ctx: LensContext): Told {
  const e = t.events;
  const title = t.title ?? t.key;
  const approve = last(e, 'record_version.approve');
  const created = last(e, 'record.create');
  const drafted = last(e, 'record_version.create');
  const checks = ctx.records?.[t.key]?.checks ?? 0;
  const withChecks = checks > 0 ? ` (${plural(checks, 'check')})` : '';
  if (approve && created) {
    return {
      event: approve,
      segments: [`${subject(approve.actor)} added and approved `, { strong: title }, '.'],
      note: `Approved v${approve.entity_version ?? 1}`,
    };
  }
  if (approve) {
    return {
      event: approve,
      segments: [`${subject(approve.actor)} approved version ${approve.entity_version ?? ''} of `, { strong: title }, '.'],
      note: `Approved v${approve.entity_version ?? ''}`,
    };
  }
  if (created) {
    return {
      event: created,
      segments: [`${subject(created.actor)} added `, { strong: title }, ` as a draft${withChecks}.`],
      note: 'New, as a draft',
    };
  }
  if (drafted) {
    return {
      event: drafted,
      segments: [
        `${subject(drafted.actor)} drafted version ${drafted.entity_version ?? ''} of `,
        { strong: title },
        `${withChecks}.`,
      ],
      note: `New draft v${drafted.entity_version ?? ''}`,
    };
  }
  const discarded = last(e, 'record_version.discard');
  if (discarded) {
    return {
      event: discarded,
      segments: [`${subject(discarded.actor)} discarded version ${discarded.entity_version ?? ''} of `, { strong: title }, '.'],
      note: `v${discarded.entity_version ?? ''} discarded`,
    };
  }
  const reviewed = last(e, 'link.keep', 'link.change', 'link.obsolete');
  if (reviewed) {
    return { event: reviewed, segments: [`${subject(reviewed.actor)} reviewed a link of `, { strong: title }, '.'], note: null };
  }
  const flagged = last(e, 'link.flag_review');
  if (flagged) {
    return {
      event: flagged,
      segments: ['A link of ', { strong: title }, ' needs a review.'],
      problem: true,
      note: 'A link to review',
    };
  }
  const replaced = last(e, 'record_version.supersede');
  if (replaced) {
    return {
      event: replaced,
      segments: [`Version ${replaced.entity_version ?? ''} of `, { strong: title }, ' was replaced.'],
      note: `v${replaced.entity_version ?? ''} replaced`,
    };
  }
  const any = e.at(-1) as Event;
  return { event: any, segments: [`${subject(any.actor)} changed `, { strong: title }, '.'], note: 'Changed' };
}

/** Records a batch is about: its dependencies, its proposals' and the records a review cites. */
export function batchTargets(b: BatchDetail | undefined): string[] {
  if (!b) return [];
  const codes = [
    ...b.dependencies.map((d) => d.code),
    ...b.proposals.flatMap((p) => p.dependencies.map((d) => d.code)),
    ...b.proposals.map((p) => (p.type === 'review' ? (p.payload.record as { code?: string } | undefined)?.code : undefined)),
  ];
  return [...new Set(codes.filter((c): c is string => typeof c === 'string' && c !== ''))];
}

const KIND_WORDS: Record<string, [string, string]> = {
  decision: ['decision', 'decisions'],
  fdr: ['feature', 'features'],
  exploration: ['thread', 'threads'],
  review: ['review', 'reviews'],
};

function proposalTitle(p: BatchDetail['proposals'][number]): string | null {
  const payload = p.payload as { title?: unknown; purpose?: unknown };
  if (typeof payload.title === 'string') return payload.title;
  if (typeof payload.purpose === 'string') return payload.purpose;
  return null;
}

function batchLine(t: ChangedThing, ctx: LensContext): Told {
  const e = t.events;
  const b = ctx.batches?.[t.key];
  const kind = t.record_type ?? b?.kind ?? '';
  const title = t.title ?? 'a batch';
  const targets = batchTargets(b);
  const proposals = count(e, 'proposal.create') || b?.proposals.length || 0;

  const accepted = last(e, 'batch.accept_package');
  if (accepted) {
    return kind === 'import'
      ? {
          event: accepted,
          segments: [`${subject(accepted.actor)} ratified the import of design/ (${plural(proposals, 'proposal')}).`],
        }
      : { event: accepted, segments: [`${subject(accepted.actor)} accepted `, { strong: title }, '.'], codes: targets };
  }
  const rejected = last(e, 'batch.reject_package');
  if (rejected) {
    return { event: rejected, segments: [`${subject(rejected.actor)} rejected `, { strong: title }, '.'], codes: targets };
  }
  const resolved = e.filter((x) => ['proposal.accept', 'proposal.accept_edited', 'proposal.reject'].includes(x.command));
  const submit = last(e, 'batch.submit', 'design.import');
  if (resolved.length > 0 && !submit) {
    const r = resolved.at(-1) as Event;
    const producer = b ? subject(b.producer) : 'an agent';
    return {
      event: r,
      segments: [
        `${subject(r.actor)} resolved ${plural(resolved.length, 'proposal')} from ${producer === 'An agent' ? 'an agent' : producer}.`,
      ],
      codes: targets,
    };
  }
  const stale = last(e, 'batch.supersede', 'proposal.supersede');
  if (stale && !submit) {
    return { event: stale, segments: [{ strong: title }, ' is out of date.'], codes: targets, note: 'A proposal is out of date' };
  }
  const s = submit ?? firstOf(e);
  if (kind === 'import') {
    return { event: s, segments: [`design/ was imported as a package of ${plural(proposals, 'proposal')}.`] };
  }
  if (kind === 'knowledge') {
    const reviews = b?.proposals.filter((p) => p.type === 'review') ?? [];
    const cited = targets.map((c) => ctx.records?.[c]?.title ?? c);
    if (cited.length === 1 || (cited.length === 0 && reviews.length <= 1)) {
      return {
        event: s,
        segments: ['Knowledge found a conflict in ', { strong: cited[0] ?? title }, '.'],
        problem: true,
        codes: targets,
        note: 'A conflict found',
      };
    }
    return {
      event: s,
      segments: [`Knowledge found conflicts in ${plural(cited.length || reviews.length, 'record')}.`],
      problem: true,
      codes: targets,
      note: 'A conflict found',
    };
  }
  const first = b?.proposals[0];
  if (kind === 'system_package' && first?.type === 'fdr') {
    const criteria = (first.payload.criteria as unknown[] | undefined)?.length ?? 0;
    return {
      event: s,
      segments: [
        `${subject(s.actor)} drafted `,
        { strong: proposalTitle(first) ?? title },
        criteria ? ` (${plural(criteria, 'check')}).` : '.',
      ],
      codes: targets,
    };
  }
  const who = subject(s.actor);
  if (targets.length > 0) {
    const named = targets.map((c) => ctx.records?.[c]?.title ?? c);
    return {
      event: s,
      segments: [`${who} proposed ${plural(proposals, 'change')} to `, { strong: named.join(', ') }, '.'],
      codes: targets,
      note: `${plural(proposals, 'change')} proposed`,
    };
  }
  const kinds = new Set(b?.proposals.map((p) => p.type) ?? []);
  const only = kinds.size === 1 ? KIND_WORDS[[...kinds][0] ?? ''] : undefined;
  const what = only ? plural(proposals, only[0], only[1]) : plural(proposals, 'proposal');
  const named = first && proposals === 1 ? proposalTitle(first) : null;
  return {
    event: s,
    segments: named ? [`${who} proposed ${what}: `, { strong: named }, '.'] : [`${who} proposed ${what}.`],
  };
}

function explorationLine(t: ChangedThing): Told {
  const e = t.events;
  const title = t.title ?? 'a thread';
  const failed = last(e, 'run.fail', 'run.interrupt');
  if (failed) {
    return {
      event: failed,
      segments: ["DEMIURGO couldn't finish in ", { strong: title }, '.'],
      problem: true,
      note: 'A run failed',
    };
  }
  const asked = e.filter((x) => x.command === 'question.raise' && !isHuman(x.actor)).length;
  const assumed = count(e, 'question.infer');
  const reply = e.findLast((x) => x.command === 'message.post' && isRun(x.actor));
  const more = [
    asked ? ` and asked ${plural(asked, 'question')}` : '',
    assumed ? `${asked ? ',' : ' and'} assumed ${plural(assumed, 'answer')}` : '',
  ].join('');
  if (reply)
    return { event: reply, segments: ['DEMIURGO answered in ', { strong: title }, `${more}.`], note: 'DEMIURGO answered' };
  if (asked || assumed) {
    const q = e.findLast((x) => (x.command === 'question.raise' && !isHuman(x.actor)) || x.command === 'question.infer') as Event;
    const what = [asked ? `asked ${plural(asked, 'question')}` : '', assumed ? `assumed ${plural(assumed, 'answer')}` : '']
      .filter(Boolean)
      .join(' and ');
    return { event: q, segments: [`DEMIURGO ${what} in `, { strong: title }, '.'], note: 'New questions' };
  }
  const agentMessage = e.findLast((x) => x.command === 'message.post' && isAgent(x.actor));
  if (agentMessage)
    return { event: agentMessage, segments: ['An agent wrote in ', { strong: title }, '.'], note: 'An agent wrote' };
  const concluded = last(e, 'exploration.conclude');
  if (concluded)
    return { event: concluded, segments: [`${subject(concluded.actor)} concluded `, { strong: title }, '.'], note: 'Concluded' };
  const aside = last(e, 'exploration.set_aside');
  if (aside) return { event: aside, segments: [`${subject(aside.actor)} set `, { strong: title }, ' aside.'], note: 'Set aside' };
  const answered = count(e, 'question.confirm');
  if (answered) {
    const a = last(e, 'question.confirm') as Event;
    return {
      event: a,
      segments: [`${subject(a.actor)} answered ${plural(answered, 'question')} in `, { strong: title }, '.'],
      note: 'Questions answered',
    };
  }
  const opened = last(e, 'exploration.open');
  const own = e.filter((x) => x.command === 'question.raise' && isHuman(x.actor)).length;
  if (opened) {
    return {
      event: opened,
      segments: [`${subject(opened.actor)} opened `, { strong: title }, own ? ` with ${plural(own, 'question')}.` : '.'],
      note: 'New thread',
    };
  }
  const wrote = e.findLast((x) => x.command === 'message.post' && isHuman(x.actor));
  if (wrote) return { event: wrote, segments: [`${subject(wrote.actor)} wrote in `, { strong: title }, '.'], note: 'You wrote' };
  const any = e.at(-1) as Event;
  return {
    event: any,
    segments: [`${subject(any.actor)} made ${plural(e.length, 'change')} in `, { strong: title }, '.'],
    note: 'Changed',
  };
}

function knowledgeLine(t: ChangedThing): Told {
  const e = t.events;
  const failed = last(e, 'knowledge_update.reject');
  if (failed) return { event: failed, segments: ['A knowledge update failed. Nothing was changed by it.'], problem: true };
  const holds = count(e, 'classification.hold');
  if (holds) {
    return {
      event: last(e, 'classification.hold') as Event,
      segments: [`Knowledge has ${plural(holds, 'classification')} for you to review.`],
    };
  }
  const ideas = count(e, 'idea_assessment.record');
  if (ideas) {
    return {
      event: last(e, 'idea_assessment.record') as Event,
      segments: [`Knowledge checked ${plural(ideas, 'idea')} against what it knows.`],
    };
  }
  const applied = count(e, 'knowledge_update.apply');
  if (applied) {
    return {
      event: last(e, 'knowledge_update.apply') as Event,
      segments: [`Knowledge was brought up to date (${plural(applied, 'update')}).`],
    };
  }
  return { event: e.at(-1) as Event, segments: ['Knowledge changed.'] };
}

function projectLine(t: ChangedThing): Told {
  const e = t.events;
  const sources = count(e, 'source.register');
  if (sources) {
    const s = last(e, 'source.register') as Event;
    return { event: s, segments: [`${subject(s.actor)} registered ${plural(sources, 'source')}.`] };
  }
  const issued = last(e, 'agent_token.issue');
  if (issued) return { event: issued, segments: [`${subject(issued.actor)} gave an agent a key.`] };
  const revoked = last(e, 'agent_token.revoke');
  if (revoked) return { event: revoked, segments: [`${subject(revoked.actor)} revoked an agent's key.`] };
  const created = last(e, 'project.create');
  if (created) return { event: created, segments: [`${subject(created.actor)} created the project.`] };
  const any = e.at(-1) as Event;
  return { event: any, segments: [`${subject(any.actor)} made ${plural(e.length, 'change')} to the project.`] };
}

export function linesOf(changes: Changes, ctx: LensContext = {}): LensLine[] {
  return changes.things
    .filter((t) => t.events.length > 0)
    .map((t) => {
      const told =
        t.kind === 'record'
          ? recordLine(t, ctx)
          : t.kind === 'batch'
            ? batchLine(t, ctx)
            : t.kind === 'exploration'
              ? explorationLine(t)
              : t.kind === 'knowledge'
                ? knowledgeLine(t)
                : projectLine(t);
      return {
        id: `${t.kind}:${t.key}`,
        kind: t.kind,
        key: t.key,
        at: told.event.at,
        actor: told.event.actor,
        segments: told.segments,
        codes: t.kind === 'record' ? [t.key] : (told.codes ?? []),
        problem: told.problem ?? false,
        note: told.note ?? null,
      };
    });
}

/** Plain text of a line (for tests and labels). */
export function lineText(line: Pick<LensLine, 'segments'>): string {
  return line.segments.map((s) => (typeof s === 'string' ? s : s.strong)).join('');
}

/** What the lens highlights: the records and threads with changes, each with its short note. */
export function changedOf(lines: LensLine[]): { records: Map<string, string | null>; threads: Map<string, string | null> } {
  const records = new Map<string, string | null>();
  const threads = new Map<string, string | null>();
  for (const l of lines) {
    if (l.kind === 'record') records.set(l.key, l.note);
    if (l.kind === 'batch') for (const c of l.codes) if (!records.has(c)) records.set(c, l.note);
    if (l.kind === 'exploration') threads.set(l.key, l.note);
  }
  return { records, threads };
}

/** True when no event left an authority state (an approved version, a confirmed question, an accepted proposal…). */
export function nothingConfirmedChanged(changes: Changes, tables: Tables): boolean {
  for (const t of changes.things) {
    for (const e of t.events) {
      const authority = tables.transitions.entities[e.entity_type]?.authority ?? [];
      if (e.state_before && authority.includes(e.state_before) && e.state_after !== e.state_before) return false;
    }
  }
  return true;
}
