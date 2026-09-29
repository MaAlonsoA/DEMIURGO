// The words of aspects.ts: each aspect's tag and the one noun a proposal or a record is called by.

import type { Aspect } from './aspects.ts';
import { messages } from './i18n/define.ts';

export const ASPECT_WORDS = messages(
  {
    product: 'Product',
    epic: 'Epic',
    feature: 'Feature',
    quality: 'Quality',
    architecture: 'Architecture',
    security: 'Security',
    operations: 'Operations',
    other: 'Other',
  } satisfies Record<Aspect, string>,
  {
    product: 'Producto',
    epic: 'Épica',
    feature: 'Funcionalidad',
    quality: 'Calidad',
    architecture: 'Arquitectura',
    security: 'Seguridad',
    operations: 'Producción',
    other: 'Otro',
  },
);

export const NOUNS = messages(
  {
    proposal: 'Proposal',
    proposals: (n: number) => `${n} ${n === 1 ? 'proposal' : 'proposals'}`,
    review: 'Review',
    thread: 'Thread',
    englishVersion: 'English version',
    document: 'Document',
    taxonomy: 'Taxonomy',
    record: 'Record',
    acceptedProposal: 'Accepted proposal',
  },
  {
    proposal: 'Propuesta',
    proposals: (n: number) => `${n} ${n === 1 ? 'propuesta' : 'propuestas'}`,
    review: 'Revisión',
    thread: 'Hilo',
    englishVersion: 'Versión en inglés',
    document: 'Documento',
    taxonomy: 'Taxonomía',
    record: 'Registro',
    acceptedProposal: 'Propuesta aceptada',
  },
);

type NounWords = (typeof NOUNS)['en'];

/** The noun of a proposal kind, in the words given. */
export function proposalNoun(type: string, w: NounWords): string {
  if (type === 'review') return w.review;
  if (type === 'exploration') return w.thread;
  if (type === 'record_translation') return w.englishVersion;
  if (type === 'imported_record') return w.document;
  if (type === 'imported_taxonomy') return w.taxonomy;
  return w.proposal;
}
