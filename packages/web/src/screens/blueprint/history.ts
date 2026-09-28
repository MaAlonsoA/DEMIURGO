// Pure logic of the History tab: the events of a record's versions (the diary, one query per
// version) merged into lines "who · what · when", newest first.

import type { EventRow } from '../../api/types.ts';
import { commandWord } from '../../words.ts';
import { HISTORY_LINES, type HistoryLinesWords } from './words.i18n.ts';

export type HistoryLine = { id: string; actor: string; words: string; at: string };

/** What happened to a version, in a few words ("Approved v2"), in the given catalog's words. */
function lineFor(command: string, n: number, words: HistoryLinesWords): string | null {
  switch (command) {
    case 'record_version.create':
      return words.versionCreated(n);
    case 'record_version.approve':
      return words.versionApproved(n);
    case 'record_version.supersede':
      return words.versionSuperseded(n);
    case 'record_version.discard':
      return words.versionDiscarded(n);
    // Link verdicts, in sentences rather than raw command words (INVENTORY INV-BP, UX problem).
    case 'link.flag_review':
      return words.linkNeedsReview(n);
    case 'link.keep':
      return words.linkKept(n);
    case 'link.change':
      return words.linkChanged(n);
    case 'link.obsolete':
      return words.linkObsolete(n);
    default:
      return null;
  }
}

export function historyLines(
  versions: readonly { id: string; n: number }[],
  events: readonly (readonly EventRow[])[],
  words: HistoryLinesWords = HISTORY_LINES.en,
): HistoryLine[] {
  const numbers = new Map(versions.map((v) => [v.id, v.n]));
  const seen = new Map<string, EventRow>();
  for (const list of events) for (const e of list) seen.set(e.id, e);
  return [...seen.values()]
    .sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : BigInt(b.id) < BigInt(a.id) ? -1 : 0))
    .map((e) => {
      const n = e.entity_version ?? numbers.get(e.entity_id) ?? 0;
      const text = lineFor(e.command, n, words) ?? words.fallback(commandWord(e.command), n);
      return { id: e.id, actor: e.actor, words: text, at: e.at };
    });
}
