// What a proposal says about itself, in words (DESIGN.md §3.1.1): its kind label, the one line under
// its title, the "why" in the author's words, what accepting it does, and what happened once it was
// decided. Pure, so Needs you, Catch up and the batch pages say the same thing. The `design_record`
// type gets its own label and body here: the old view showed its raw type name (INVENTORY Part D §3).

import type { AspectCheck, BasisRefs, BatchDetail, Dependency, IdeaAssessmentSummary } from '../../api/types.ts';
import { NOUNS, proposalNoun } from '../../aspects.i18n.ts';
import type { Locale } from '../../i18n/locale.ts';
import { typeOfCode } from '../../components/types.tsx';
import { batchView, proposalTitle, recordChangeParts, recordChangeWhat } from './model.ts';

/** A proposal as the views show it: the batch's fields plus what the inbox adds to pending ones. */
export type ProposalView = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  state: string;
  dependencies: Dependency[];
  resolution?: Record<string, unknown> | null;
  resolved_at?: string | null;
  /** The server's reasons why accepting would fail now (its dependencies changed). */
  obsolescence?: string[];
  assessment?: IdeaAssessmentSummary | null;
  /** What Jev says the proposal's own text is about. */
  aspect_check?: AspectCheck | null;
  /** The threads behind the messages and questions it is based on. */
  basis_refs?: BasisRefs;
};

/** What kind of change a proposal is, in one noun ("Proposal", "Review", "Thread"…); the aspect goes in a tag. */
export function kindWord(type: string, locale: Locale = 'en'): string {
  return proposalNoun(type, NOUNS[locale]);
}

/** The record type an accepted proposal makes (or a review is about), for its icon. */
export function proposalIconType(p: Pick<ProposalView, 'type' | 'payload'>): string {
  if (p.type === 'decision' || p.type === 'fdr') return p.type;
  if (p.type === 'exploration') return 'thread';
  if (p.type === 'design_record') return typeof p.payload.record_type === 'string' ? p.payload.record_type : 'decision';
  if (p.type === 'review') return 'knowledge';
  if (p.type === 'imported_record') {
    const doc = p.payload.document as { type?: unknown } | undefined;
    return typeof doc?.type === 'string' ? doc.type : 'package';
  }
  if (p.type === 'imported_taxonomy') return 'taxonomy';
  if (p.type === 'record_translation') return 'package';
  if (p.type === 'product_definition' || p.type === 'definition_change') return 'product_definition';
  if (p.type === 'feature_plan') return 'epic';
  if (p.type === 'record_change') return typeOfCode(str((p.payload.record as { code?: unknown } | undefined)?.code)) ?? 'idea';
  return 'idea';
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export type PayloadSection = { title: string; content: string };

/** The sections a design record carries in its payload. */
export function payloadSections(payload: Record<string, unknown>): PayloadSection[] {
  if (!Array.isArray(payload.sections)) return [];
  return (payload.sections as { title?: unknown; content?: unknown }[])
    .map((s) => ({ title: str(s.title), content: str(s.content) }))
    .filter((s) => s.title || s.content);
}

export type PayloadCheck = { code?: string; title: string; statement: string; verification: string; check: string; step?: number | null };

/** The checks (acceptance criteria) a proposal carries, as they came. */
export function payloadChecks(payload: Record<string, unknown>): PayloadCheck[] {
  return Array.isArray(payload.criteria) ? (payload.criteria as PayloadCheck[]) : [];
}

/** The one line under a title in a list: the proposal's main text. */
export function proposalLine(p: Pick<ProposalView, 'type' | 'payload'>): string {
  if (p.type === 'decision') return str(p.payload.decision);
  if (p.type === 'fdr') return str(p.payload.goal);
  if (p.type === 'review') return str(p.payload.reason);
  if (p.type === 'exploration') return str(p.payload.purpose);
  if (p.type === 'definition_change') return str(p.payload.content);
  if (p.type === 'record_change') {
    const { sections, criteria } = recordChangeParts(p.payload);
    return sections[0]?.content ?? criteria[0]?.statement ?? criteria[0]?.code ?? '';
  }
  if (p.type === 'feature_plan') return str(p.payload.summary) || str(p.payload.reason);
  if (p.type === 'design_record' || p.type === 'record_translation' || p.type === 'product_definition')
    return payloadSections(p.payload)[0]?.content ?? '';
  return '';
}

/** Why, in the author's own words: the context of a decision, the goal of a feature, the reason of a review. */
export function proposalWhy(p: Pick<ProposalView, 'type' | 'payload'>): string {
  if (p.type === 'decision') return str(p.payload.context);
  if (p.type === 'fdr') return str(p.payload.goal);
  if (p.type === 'review' || p.type === 'definition_change' || p.type === 'record_change' || p.type === 'feature_plan')
    return str(p.payload.reason);
  return '';
}

/**
 * What accepting does, before it happens (INV-PROP-15, 16), in one plain sentence: accepting keeps
 * working on it as an accepted proposal; approving settles it.
 */
export function acceptEffects(p: Pick<ProposalView, 'type' | 'payload'>, approve: boolean, locale: Locale = 'en'): string[] {
  const es = locale === 'es';
  if (p.type === 'review') {
    const r = p.payload.record as { code?: string } | undefined;
    const code = r?.code ?? (es ? 'el registro' : 'the record');
    return [
      es
        ? `DEMIURGO abre un hilo para revisar ${code}. El registro en sí no cambia.`
        : `DEMIURGO opens a thread to review ${code}. The record itself doesn't change.`,
    ];
  }
  if (p.type === 'exploration')
    return [es ? `DEMIURGO abre el hilo «${proposalTitle(p)}».` : `DEMIURGO opens the thread “${proposalTitle(p)}”.`];
  if (p.type === 'definition_change') {
    const section = str(p.payload.section);
    return es
      ? [
          `DEMIURGO cambia «${section}» en la definición del producto, tal como dice aquí.`,
          'Queda asentada al momento: aceptarla la aprueba. Lo que decía antes se queda en su historial.',
        ]
      : [
          `DEMIURGO changes “${section}” in the product definition, as it says here.`,
          'It is settled at once: accepting it approves it. What it said before stays in its history.',
        ];
  }
  if (p.type === 'record_change') {
    const r = p.payload.record as { code?: string; version?: number } | undefined;
    const code = r?.code ?? (es ? 'el registro' : 'the record');
    const what = recordChangeWhat(p.payload, locale);
    return es
      ? [
          `DEMIURGO cambia ${what} en ${code}, tal como dice aquí: una versión nueva del registro, con sus criterios de aceptación y enlaces.`,
          approve
            ? 'Queda asentada: aprobarla la pone en vigor.'
            : 'Sigues trabajando en ella: la versión nueva queda como propuesta aceptada, aún sin asentar.',
        ]
      : [
          `DEMIURGO changes ${what} in ${code}, as it says here: a new version of the record, with its acceptance criteria and links.`,
          approve
            ? 'It is settled: approving it puts it in force.'
            : 'You keep working on it: the new version is recorded as an accepted proposal, not settled yet.',
        ];
  }
  if (p.type === 'feature_plan') {
    const epic = str((p.payload.epic as { code?: unknown } | undefined)?.code) || (es ? 'la épica' : 'the epic');
    const action = str(p.payload.action);
    const code = str(p.payload.code);
    return es
      ? [
          action === 'add'
            ? `DEMIURGO añade «${str(p.payload.name)}» a la lista de funcionalidades de ${epic} y le reserva su código.`
            : action === 'drop'
              ? `DEMIURGO quita ${code} de la lista de funcionalidades de ${epic}. Su código no se vuelve a usar.`
              : `DEMIURGO mueve ${code} a otro puesto de la lista de funcionalidades de ${epic}.`,
          'No hay nada que aprobar: la lista no es una versión de la épica.',
        ]
      : [
          action === 'add'
            ? `DEMIURGO adds “${str(p.payload.name)}” to the list of features of ${epic} and reserves its code.`
            : action === 'drop'
              ? `DEMIURGO drops ${code} from the list of features of ${epic}. Its code is never reused.`
              : `DEMIURGO moves ${code} to another place in the list of features of ${epic}.`,
          'There is nothing to approve: the list is not a version of the epic.',
        ];
  }
  const listed = p.type === 'design_record' && Array.isArray(p.payload.features) ? p.payload.features.length : 0;
  const listing =
    listed > 0
      ? [
          es
            ? `Sus ${listed} funcionalidades quedan en su lista al momento, cada una con su código reservado.`
            : `Its ${listed} features go into its list at once, each with its code reserved.`,
        ]
      : [];
  if (approve)
    return [
      es
        ? 'Queda asentada: DEMIURGO y los siguientes pasos parten de ella.'
        : 'It is settled: DEMIURGO and the next steps build on it.',
      ...listing,
    ];
  return [
    es
      ? 'Sigues trabajando en ella: queda como propuesta aceptada, aún sin asentar.'
      : 'You keep working on it: it is recorded as an accepted proposal, not settled yet.',
    ...listing,
  ];
}

/** What happened to a decided proposal, in one sentence (the state badge says the state). */
export function resolvedText(state: string, effect: { code: string; approved: boolean } | null, locale: Locale = 'en'): string {
  const es = locale === 'es';
  const made = effect
    ? effect.approved
      ? es
        ? ` ${effect.code} es un registro: queda asentado.`
        : ` ${effect.code} is a record: settled.`
      : es
        ? ` ${effect.code} es una propuesta aceptada: sigues trabajando en ella.`
        : ` ${effect.code} is an accepted proposal: you keep working on it.`
    : '';
  if (state === 'accepted') return `${es ? 'La aceptaste.' : 'You accepted it.'}${made}`;
  if (state === 'accepted_edited') return `${es ? 'Aceptaste tu versión.' : 'You accepted your version.'}${made}`;
  if (state === 'rejected') return es ? 'La rechazaste.' : 'You rejected it.';
  return '';
}

/** The out-of-date sentence of a superseded proposal: the server's reason, then what it means. */
export function outOfDateText(reason: string | null): string {
  return `${reason ?? 'What it was based on changed.'} It can't be accepted any more. Nothing is lost: it stays here as it came.`;
}

/** The heading of a batch, the same whoever made it: how many proposals, and what to do with them. */
export function batchHeading(n: number, locale: Locale = 'en', left: number = n): { eyebrow: string; title: string } {
  const es = locale === 'es';
  const title =
    left === 0
      ? es
        ? `${NOUNS.es.proposals(n)}: nada por decidir`
        : `${NOUNS.en.proposals(n)}: nothing left to decide`
      : es
        ? `${NOUNS.es.proposals(left)} por decidir`
        : `${NOUNS.en.proposals(left)} to decide`;
  return { eyebrow: NOUNS[locale].proposals(n), title };
}

/** The name of a batch page, as its h1 and the browser tab say it. */
export function batchTitle(batch: Pick<BatchDetail, 'kind' | 'resolution_mode' | 'producer' | 'proposals'>): string {
  const view = batchView(batch);
  if (view === 'import') return 'Imported from design/';
  if (view === 'package') {
    const single = batch.proposals.length === 1 ? batch.proposals[0] : undefined;
    return (single ? proposalTitle(single) : '') || NOUNS.en.proposals(batch.proposals.length);
  }
  return batchHeading(batch.proposals.length, 'en', batch.proposals.filter((p) => p.state === 'pending').length).title;
}
