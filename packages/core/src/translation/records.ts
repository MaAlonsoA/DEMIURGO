// The English versions of older records (records are always in English). DEMIURGO walks the
// project's records, finds the ones whose current text is not in English, translates them with the
// translator agent and proposes each English version in a batch the person resolves item by item.
// Nothing changes until the person accepts: accepting creates a new version of the record.

import { looksEnglish, system, type TranslationFields, versionFields } from '@demiurgo/domain';
import { sql } from 'kysely';
import { executeCommand } from '../bus/bus.ts';
import type { Services } from '../services.ts';
import { translateFields } from './index.ts';

export const TRANSLATION_ACTOR = system('translation');

type Current = {
  record_id: string;
  code: string;
  version_id: string;
  n: number;
  title: string;
  sections: { title: string; content: string }[];
};

export type EnglishProposals = {
  batchIds: string[];
  /** Codes proposed, with the version each one translates. */
  proposed: { code: string; version: number }[];
  /** Records left out and why (already English, already proposed, the translation failed…). */
  skipped: { code: string; reason: string }[];
};

/** Whether every prose field of a version reads as English (short or technical texts count as fine). */
export function isEnglishVersion(fields: TranslationFields): boolean {
  return Object.values(fields).every(looksEnglish);
}

/** Proposes the English version of up to `limit` records that are not in English yet. */
export async function proposeEnglishVersions(
  s: Services,
  projectId: string,
  options: { limit?: number } = {},
): Promise<EnglishProposals> {
  const limit = options.limit ?? 20;
  const { rows: current } = await sql<Current>`
    select distinct on (v.record_id) v.record_id, r.code, v.id as version_id, v.n, v.title, v.sections
    from record_versions v join records r on r.id = v.record_id
    where v.project_id = ${projectId} and v.state <> 'discarded' and r.state <> 'discarded'
    order by v.record_id, v.n desc`.execute(s.db);
  const pending = await s.db
    .selectFrom('proposals')
    .select(sql<string>`payload->'record'->>'code'`.as('code'))
    .where('project_id', '=', projectId)
    .where('type', '=', 'record_translation')
    .where('state', '=', 'pending')
    .execute();
  const alreadyProposed = new Set(pending.map((p) => p.code));

  const result: EnglishProposals = { batchIds: [], proposed: [], skipped: [] };
  const proposals: { type: 'record_translation'; payload: unknown; dependencies: unknown[] }[] = [];
  for (const v of current.toSorted((a, b) => a.code.localeCompare(b.code))) {
    if (proposals.length >= limit) break;
    const criteria = await s.db
      .selectFrom('criteria')
      .select(['code', 'title', 'statement', 'check_text'])
      .where('record_version_id', '=', v.version_id)
      .orderBy('position')
      .execute();
    const source = versionFields({ title: v.title, sections: v.sections, criteria });
    if (isEnglishVersion(source)) continue;
    if (alreadyProposed.has(v.code)) {
      result.skipped.push({ code: v.code, reason: 'Its English version is already waiting for you.' });
      continue;
    }
    let fields: Record<string, string>;
    try {
      fields = (await translateFields(s, { projectId, subject: 'record_version', id: v.version_id, lang: 'en', source })).fields;
    } catch (e) {
      result.skipped.push({ code: v.code, reason: e instanceof Error ? e.message : String(e) });
      continue;
    }
    const english = (key: string, original: string) => fields[key] ?? original;
    proposals.push({
      type: 'record_translation',
      payload: {
        record: { code: v.code, version: v.n },
        title: english('title', v.title),
        sections: v.sections.map((sec, i) => ({ title: sec.title, content: english(`sections.${i}.content`, sec.content) })),
        criteria: criteria.map((c) => ({
          code: c.code,
          title: english(`criteria.${c.code}.title`, c.title),
          statement: english(`criteria.${c.code}.statement`, c.statement),
          check: english(`criteria.${c.code}.check`, c.check_text),
        })),
      },
      // If the record gets another version before the person decides, this one is out of date.
      dependencies: [{ type: 'record', id: v.record_id, code: v.code, version: v.n }],
    });
    result.proposed.push({ code: v.code, version: v.n });
  }

  for (let i = 0; i < proposals.length; i += 50) {
    const chunk = proposals.slice(i, i + 50);
    const r = await executeCommand(s, {
      command: 'batch.submit',
      actor: TRANSLATION_ACTOR,
      projectId,
      data: {
        summary: `English versions of ${chunk.length} ${chunk.length === 1 ? 'record' : 'records'} written in another language: the same content, translated by DEMIURGO for you to check.`,
        batch_type: 'system_package',
        resolution: 'item',
        proposals: chunk,
      },
    });
    result.batchIds.push(r.entityId);
  }
  return result;
}
