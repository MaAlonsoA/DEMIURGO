// The manifest a builder writes while it gathers a context pack (observability §9.1): one fragment
// per candidate it weighed, in PROV terms (what it derives from, what the builder did with it and
// why), whether the candidate entered the pack or not. `seq` is the order of consideration;
// `position` is the order inside the pack, only for what entered. The manifest never enters the
// pack's hash nor the operational base: it is emitted as the `demiurgo.context.manifest` note.

import { type Fragment, type FragmentDecision, type Manifest, sha256Hex } from '@demiurgo/domain';
import type { ContextKnowledge } from './knowledge.ts';

export type FragmentSource = Fragment['source'];

type Entered = {
  section: string;
  source: FragmentSource;
  /** The text as it enters the pack (already cut when it is truncated). */
  text: string;
  /** Size before cutting; the text's own size when nothing was cut. */
  originalChars?: number;
  /** Characters the section's budget charges for it; the text's size when not given. */
  chars?: number;
  reason: string;
  score?: number | null;
  /** `included` when the text is whole, `truncated` when it was cut; decided from the sizes when not given. */
  decision?: Exclude<FragmentDecision, 'dropped'>;
};

type Dropped = {
  section: string;
  source: FragmentSource;
  /** The text as it would have entered. */
  text: string;
  originalChars?: number;
  chars?: number;
  reason: string;
  score?: number | null;
};

export class ManifestBuilder {
  readonly #builder: string;
  readonly #graphVersion: number;
  readonly #budget: Record<string, number>;
  readonly #fragments: Fragment[] = [];
  #position = 0;

  constructor(builder: string, graphVersion: number, budget: Record<string, number>) {
    this.#builder = builder;
    this.#graphVersion = graphVersion;
    this.#budget = budget;
  }

  /** A candidate that entered the pack, whole or cut. Call in pack order: the position follows it. */
  entered(f: Entered): Fragment {
    const originalChars = f.originalChars ?? f.text.length;
    const chars = f.chars ?? f.text.length;
    const decision = f.decision ?? (originalChars > f.text.length ? 'truncated' : 'included');
    return this.#push(f, chars, originalChars, decision, this.#position++);
  }

  /** A candidate that stayed out, with the reason (`budget:messages`, `limit:60`, `below_threshold`…). */
  dropped(f: Dropped): Fragment {
    return this.#push(f, f.chars ?? f.text.length, f.originalChars ?? f.text.length, 'dropped', null);
  }

  #push(f: Dropped, chars: number, originalChars: number, decision: FragmentDecision, position: number | null): Fragment {
    const fragment: Fragment = {
      seq: this.#fragments.length + 1,
      section: f.section,
      source: f.source,
      textHash: sha256Hex(f.text),
      chars,
      originalChars,
      decision,
      reason: f.reason,
      score: f.score ?? null,
      position,
    };
    this.#fragments.push(fragment);
    return fragment;
  }

  build(): Manifest {
    return {
      builder: this.#builder,
      graphVersion: this.#graphVersion,
      budget: { ...this.#budget },
      fragments: [...this.#fragments],
      candidates: this.#fragments.length,
    };
  }
}

/** A source that is a plain value of the request, not an authority entity. */
export const inputSource = (id: string): FragmentSource => ({ type: 'input', id, version: null, eventSeq: null });

/**
 * The `knowledge` section: one fragment per node the selector weighed, whose text is the label
 * and the (cut) text as the pack carries them, charged as the knowledge budget charges it.
 */
export function recordKnowledge(manifest: ManifestBuilder, knowledge: ContextKnowledge): void {
  for (const n of knowledge.considered) {
    const source: FragmentSource = { type: 'knowledge_node', id: n.ref, version: knowledge.graphVersion, eventSeq: null };
    const text = `${n.title}\n${n.text}`;
    const chars = n.title.length + n.text.length;
    if (n.reason === 'chosen') {
      manifest.entered({
        section: 'knowledge',
        source,
        text,
        chars,
        originalChars: n.originalChars,
        decision: n.originalChars > chars ? 'truncated' : 'included',
        reason: `relevance:${n.score.toFixed(2)}`,
        score: n.score,
      });
    } else {
      manifest.dropped({
        section: 'knowledge',
        source,
        text,
        chars,
        originalChars: n.originalChars,
        reason: n.reason === 'budget' ? 'budget:knowledge' : 'below_threshold',
        score: n.score,
      });
    }
  }
}
