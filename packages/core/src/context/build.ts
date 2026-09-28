// Context pack builders by action. They gather from authority what each
// builder declares and return a deterministic pack: same scope and same graph → same hash.
// Next to the pack, every builder returns its manifest (observability §9): what it weighed and
// what it did with each candidate. The manifest never enters the hash.

import { type AgentAction, DomainError, type Fragment, type Manifest, sha256Hex } from '@demiurgo/domain';
import { projectGlossary } from '../commands/glossary.ts';
import type { Tx } from '../db/connection.ts';
import type { PackData } from '../commands/packs.ts';
import { ManifestBuilder, inputSource } from './manifest.ts';

export type Scope = { type: string; id?: string | undefined; version?: number | undefined };

export type Built = { pack: PackData; manifest: Manifest };

export type Builder = (a: {
  trx: Tx;
  projectId: string;
  scope: Scope;
  input: Record<string, unknown>;
  graphVersion: number;
}) => Promise<Built>;

const ECHO_CHARS = 2000;

export const BUILDERS: Partial<Record<AgentAction, Builder>> = {
  async echo({ input, graphVersion }) {
    const budget = { characters: ECHO_CHARS };
    const original = typeof input.text === 'string' ? input.text : '';
    const text = original.slice(0, ECHO_CHARS);
    const manifest = new ManifestBuilder('echo@1', graphVersion, budget);
    manifest.entered({
      section: 'input',
      source: inputSource('text'),
      text,
      originalChars: original.length,
      reason: original.length > text.length ? `excerpt:${ECHO_CHARS}` : 'input',
    });
    return {
      pack: {
        role: 'echo',
        constructor: 'echo@1',
        budget,
        graph_version: graphVersion,
        dependencies: [],
        content: { input: { text } },
      },
      manifest: manifest.build(),
    };
  },
};

export function registerBuilder(action: AgentAction, r: Builder): void {
  BUILDERS[action] = r;
}

export async function buildContext(
  trx: Tx,
  projectId: string,
  action: AgentAction,
  scope: Scope,
  input: Record<string, unknown>,
  graphVersion: number,
): Promise<Built> {
  const r = BUILDERS[action];
  if (!r) throw new DomainError('not_implemented', `No context builder for "${action}".`);
  const built = await r({ trx, projectId, scope, input, graphVersion });
  if (!RECORD_WRITERS.has(action)) return built;
  return withDefinition(trx, projectId, await withGlossary(trx, projectId, built));
}

/** The actions whose output becomes records: they write them in English with the project's terms. */
const RECORD_WRITERS: ReadonlySet<AgentAction> = new Set(['exploration_chat', 'design_proposal']);

/** A fragment added after the builder's own: next in sequence and in position. */
function appended(
  built: Built,
  fragment: Omit<Fragment, 'seq' | 'position' | 'textHash' | 'chars' | 'originalChars'>,
  text: string,
): Fragment {
  const fragments = built.manifest.fragments;
  return {
    ...fragment,
    seq: fragments.length + 1,
    textHash: sha256Hex(text),
    chars: text.length,
    originalChars: text.length,
    position: fragments.filter((f) => f.position !== null).length,
  };
}

/**
 * Adds the product definition's approved version, whole and never cut: every agent that writes
 * records works within what the product is. It is a dependency of the pack, so a run knows which
 * version it read. Without an approved definition the pack is unchanged (and keeps its hash).
 */
async function withDefinition(trx: Tx, projectId: string, built: Built): Promise<Built> {
  const v = await trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.id as recordId', 'records.code', 'record_versions.id', 'record_versions.n', 'record_versions.sections'])
    .where('records.project_id', '=', projectId)
    .where('records.type', '=', 'product_definition')
    .where('record_versions.state', '=', 'approved')
    .orderBy('record_versions.n', 'desc')
    .executeTakeFirst();
  if (!v) return built;
  const product_definition = { code: v.code, version: v.n, sections: v.sections as { title: string; content: string }[] };
  const fragment = appended(
    built,
    {
      section: 'product_definition',
      source: { type: 'record_version', id: v.id, version: v.n, eventSeq: null },
      decision: 'included',
      reason: 'product definition',
      score: null,
    },
    JSON.stringify(product_definition),
  );
  const dependencies = built.pack.dependencies.some((d) => d.id === v.recordId)
    ? built.pack.dependencies
    : [...built.pack.dependencies, { type: 'record', id: v.recordId, version: v.n }];
  return {
    pack: { ...built.pack, dependencies, content: { ...(built.pack.content as Record<string, unknown>), product_definition } },
    manifest: { ...built.manifest, fragments: [...built.manifest.fragments, fragment] },
  };
}

/** Adds the project's glossary to the pack (only when it has one, so packs without it keep their hash). */
async function withGlossary(trx: Tx, projectId: string, built: Built): Promise<Built> {
  const glossary = (await projectGlossary(trx, projectId)).map((g) => ({ term: g.term, english: g.english }));
  if (glossary.length === 0) return built;
  const content = { ...(built.pack.content as Record<string, unknown>), glossary };
  const fragment = appended(
    built,
    {
      section: 'glossary',
      source: { type: 'glossary_term', id: projectId, version: null, eventSeq: null },
      decision: 'included',
      reason: 'glossary',
      score: null,
    },
    JSON.stringify(glossary),
  );
  return {
    pack: { ...built.pack, content },
    manifest: { ...built.manifest, fragments: [...built.manifest.fragments, fragment] },
  };
}
