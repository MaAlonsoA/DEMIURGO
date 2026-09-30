// What the drafting agents (epic_plan, feature_design, task_plan) share: each writes one kind of
// record from a determined output, and the system turns that output into proposals. Routing to a
// dedicated agent plus a programmatic check after the model call is the pattern of Anthropic's
// "Building effective agents" (routing, and gates between steps).

import { type ActionOutput, type Fragment, PUBLIC_DESIGN_SYSTEMS, composeStatement, designSystemPathOf, sha256Hex } from '@demiurgo/domain';
import type { Built } from '../context/build.ts';
import type { Db, Tx } from '../db/connection.ts';
import type { Row } from '../db/schema.ts';

/** The pack of a drafting agent: the same content as its source pack, under its own builder name. */
export function relabelPack(built: Built, builder: string): Built {
  return {
    pack: { ...built.pack, role: 'design', constructor: builder },
    manifest: { ...built.manifest, builder },
  };
}

type GivenWhenThen = {
  title: string;
  given: string;
  when: string;
  then: string;
  verification: 'automatic' | 'manual';
  check: string;
};

/** A Given/When/Then criterion as a proposal payload keeps it: the three parts, the composed statement and its step. */
export function criterionPayload(c: GivenWhenThen & { step?: number }) {
  return {
    title: c.title,
    given: c.given,
    when: c.when,
    then: c.then,
    statement: composeStatement(c),
    verification: c.verification,
    check: c.check,
    step: c.step ?? null,
  };
}

/** The practice sources of a draft, only when it cites any. */
export function sourcesPayload(sources: ActionOutput<'epic_plan'>['sources']) {
  return sources.length > 0 ? { sources } : {};
}

/** "Based on": the person's latest messages of the thread the draft was written from. */
export async function threadBasis(db: Db | Tx, explorationId: string) {
  const rows = await db
    .selectFrom('messages')
    .select('id')
    .where('exploration_id', '=', explorationId)
    .where('author', 'like', 'human:%')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(5)
    .execute();
  return rows.map((r) => ({ type: 'message' as const, id: r.id }));
}

/** The content of the context pack the run was given. */
export async function packContentOf<T>(trx: Db | Tx, run: Row<'ai_runs'>): Promise<T> {
  const pack = await trx
    .selectFrom('context_packs')
    .select('content')
    .where('id', '=', run.context_pack_id ?? '')
    .executeTakeFirstOrThrow();
  return pack.content as T;
}

/** Adds one section to the pack and to its manifest, as a fragment that came from `source`. */
export function withSection(
  built: Built,
  section: string,
  value: unknown,
  source: Fragment['source'],
  reason: string,
): Built {
  const text = JSON.stringify(value);
  const fragments = built.manifest.fragments;
  const fragment: Fragment = {
    seq: fragments.length + 1,
    position: fragments.filter((f) => f.position !== null).length,
    section,
    source,
    decision: 'included',
    reason,
    score: null,
    textHash: sha256Hex(text),
    chars: text.length,
    originalChars: text.length,
  };
  return {
    pack: { ...built.pack, content: { ...(built.pack.content as Record<string, unknown>), [section]: value } },
    manifest: { ...built.manifest, fragments: [...fragments, fragment] },
  };
}

/** What a design-system thread is about: the path it takes and its base (a public system, or none). */
export async function designThreadOf(db: Db | Tx, projectId: string, explorationId: string) {
  const thread = await db
    .selectFrom('explorations')
    .select('purpose')
    .where('id', '=', explorationId)
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  const path = thread ? designSystemPathOf(thread.purpose) : null;
  if (!path) return null;
  if (path.kind === 'scratch') return { path: 'scratch' as const, base: { kind: 'scratch' as const } };
  const known = PUBLIC_DESIGN_SYSTEMS.find((s) => s.name.toLowerCase() === path.name.toLowerCase());
  return {
    path: 'public' as const,
    base: { kind: 'public' as const, name: known?.name ?? path.name, ...(known ? { url: known.url, license: known.license } : {}) },
  };
}
