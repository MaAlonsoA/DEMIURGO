// Pure pieces of how a build attempt remembers and shows its work, from Anthropic's «Effective harnesses for long-running
// agents»: a progress file that the next session reads («Read the git logs and progress files to get up to speed»),
// descriptive commit messages, and screenshots as evidence that a feature works end to end. The per-attempt cap, the
// `## Attempt N` headers, the screenshots folder and its limits are our convention.

/** Characters of one attempt's progress notes that are kept and restored (convención nuestra). */
export const PROGRESS_ATTEMPT_MAX_CHARS = 4000;

/** Characters of the build report's summary that go into the commit message body (convención nuestra). */
export const COMMIT_BODY_MAX_CHARS = 1500;

/** The folder the builder leaves screenshots in, one `<criterion>.png` per criterion (convención nuestra). */
export const SCREENS_DIR = '.demiurgo/screens';
export const SCREENS_MAX = 20;
export const SCREEN_MAX_BYTES = 5_000_000;

const cap = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max).trimEnd()}\n… (truncated)` : text);

/** The progress file handed to an attempt: the notes of every earlier attempt, oldest first, each under `## Attempt N` and capped. */
export function accumulateProgress(entries: readonly { attempt: number; text: string }[], max: number = PROGRESS_ATTEMPT_MAX_CHARS): string {
  return entries
    .filter((e) => e.text.trim().length > 0)
    .sort((a, b) => a.attempt - b.attempt)
    .map((e) => `## Attempt ${e.attempt}\n${cap(e.text.trim(), max)}`)
    .join('\n\n');
}

/**
 * What this attempt itself wrote into the progress file: the file's content minus the restored part it started with.
 * When the builder rewrote the file from scratch (it no longer starts with what was restored), the whole file is its own.
 */
export function ownProgress(file: string, restored: string, max: number = PROGRESS_ATTEMPT_MAX_CHARS): string {
  const text = file.trim();
  const before = restored.trim();
  const own = before.length > 0 && text.startsWith(before) ? text.slice(before.length).trim() : text;
  return own.slice(0, max);
}

/** The commit message: the title, the build report's summary as its body (what the commit does, in the builder's words); the caller adds the trailers after it. */
export function commitMessageOf(title: string, summary: string | null | undefined): string {
  const body = (summary ?? '').trim();
  if (!body || body === 'No report from the builder.') return title;
  return `${title}\n\n${cap(body, COMMIT_BODY_MAX_CHARS)}`;
}

/** The screenshots among the entries of the screens folder: `<criterion>.png`, a plain file name, at most SCREENS_MAX. */
export function screensOf(entries: readonly string[]): { criterion: string; file: string }[] {
  return entries
    .filter((f) => /^[\w][\w.-]{0,120}\.png$/i.test(f))
    .sort()
    .slice(0, SCREENS_MAX)
    .map((file) => ({ criterion: file.replace(/\.png$/i, ''), file }));
}

/** Whether two file lists hold the same paths, in any order. */
export function sameFileList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((f) => set.has(f));
}
