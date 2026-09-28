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
  return RECORD_WRITERS.has(action) ? withGlossary(trx, projectId, built) : built;
}

/** The actions whose output becomes records: they write them in English with the project's terms. */
const RECORD_WRITERS: ReadonlySet<AgentAction> = new Set(['exploration_chat', 'design_proposal']);

/** Adds the project's glossary to the pack (only when it has one, so packs without it keep their hash). */
async function withGlossary(trx: Tx, projectId: string, built: Built): Promise<Built> {
  const glossary = (await projectGlossary(trx, projectId)).map((g) => ({ term: g.term, english: g.english }));
  if (glossary.length === 0) return built;
  const content = { ...(built.pack.content as Record<string, unknown>), glossary };
  const text = JSON.stringify(glossary);
  const fragments = built.manifest.fragments;
  const fragment: Fragment = {
    seq: fragments.length + 1,
    section: 'glossary',
    source: { type: 'glossary_term', id: projectId, version: null, eventSeq: null },
    textHash: sha256Hex(text),
    chars: text.length,
    originalChars: text.length,
    decision: 'included',
    reason: 'glossary',
    score: null,
    position: fragments.filter((f) => f.position !== null).length,
  };
  return { pack: { ...built.pack, content }, manifest: { ...built.manifest, fragments: [...fragments, fragment] } };
}
