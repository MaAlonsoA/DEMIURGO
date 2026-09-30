// A thread's purpose can be a whole idea (600+ characters). Where it is shown as a title, this
// is the short form: the first sentence, cut on a word boundary. The full purpose stays readable
// elsewhere on the thread page.

export const THREAD_TITLE_MAX = 80;

/**
 * First sentence of a purpose (up to the first `.`, `?` or `!` followed by a space or the end, or
 * the first line break), cut at `max` characters on a word boundary with «…». A final full stop is
 * dropped; `?` and `!` stay.
 */
export function threadTitle(purpose: string, max = THREAD_TITLE_MAX): string {
  const text = purpose.trim();
  const line = text.split(/\r?\n/, 1)[0] ?? '';
  const end = /[.?!](?=\s|$)/.exec(line);
  let sentence = (end ? line.slice(0, end.index + 1) : line).trim();
  if (sentence.endsWith('.')) sentence = sentence.slice(0, -1).trimEnd();
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max);
  // Back to the last space unless the cut already fell on one.
  const atBoundary = /\s/.test(sentence.charAt(max));
  const words = atBoundary ? cut : cut.replace(/\s+\S*$/, '');
  return `${(words || cut).trimEnd().replace(/[,;:\-–—]$/, '')}…`;
}

/** Whether the purpose says more than its short title does (so the full text is worth showing). */
export function hasMoreThanTitle(purpose: string): boolean {
  const text = purpose.trim();
  const title = threadTitle(text);
  return text !== title && text !== `${title}.`;
}
