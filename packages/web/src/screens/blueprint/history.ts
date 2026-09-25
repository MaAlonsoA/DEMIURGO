// Pure logic of the History tab: the events of a record's versions (the diary, one query per
// version) merged into lines "who · what · when", newest first.

import type { EventRow } from '../../api/types.ts';
import { commandWord } from '../../words.ts';

export type HistoryLine = { id: string; actor: string; words: string; at: string };

/** What happened to a version, in a few words ("Approved v2"). */
const WORDS: Record<string, (n: number) => string> = {
  'record_version.create': (n) => `Created v${n}`,
  'record_version.approve': (n) => `Approved v${n}`,
  'record_version.supersede': (n) => `v${n} was replaced`,
  'record_version.discard': (n) => `Discarded v${n}`,
  // Link verdicts, in sentences rather than raw command words (INVENTORY INV-BP, UX problem).
  'link.flag_review': (n) => `A link of v${n} needs a review`,
  'link.keep': (n) => `Kept a link of v${n}`,
  'link.change': (n) => `Marked a link of v${n} as changed`,
  'link.obsolete': (n) => `Marked a link of v${n} out of date`,
};

export function historyLines(
  versions: readonly { id: string; n: number }[],
  events: readonly (readonly EventRow[])[],
): HistoryLine[] {
  const numbers = new Map(versions.map((v) => [v.id, v.n]));
  const seen = new Map<string, EventRow>();
  for (const list of events) for (const e of list) seen.set(e.id, e);
  return [...seen.values()]
    .sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : BigInt(b.id) < BigInt(a.id) ? -1 : 0))
    .map((e) => {
      const n = e.entity_version ?? numbers.get(e.entity_id) ?? 0;
      const words = WORDS[e.command]?.(n) ?? `${commandWord(e.command)} · v${n}`;
      return { id: e.id, actor: e.actor, words, at: e.at };
    });
}
