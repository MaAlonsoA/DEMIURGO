// What the next build attempt (and the person) learns about a red CI: each failing test with its criterion code,
// title, file and failure message, and whether the same test passed on other commits (a hint of environment or
// flakiness). Pure: the evidence step computes the data, this only words it.

/** Window of the «passed elsewhere» look-back (convención nuestra). */
export const PASSED_ELSEWHERE_DAYS = 7;

export type CiFailureDetail = { code: string | null; test: string; file: string | null; message: string; passed_elsewhere?: number };

/** One block per failing test: code, title, file, the message quoted, and whether it passed on other commits. */
export function ciFailureLines(failures: CiFailureDetail[]): string[] {
  const lines: string[] = [];
  for (const f of failures) {
    lines.push(`- ${f.code ? `${f.code}: ` : ''}${f.test}${f.file ? ` (${f.file})` : ''}`);
    lines.push('  Failure message:', ...f.message.split('\n').map((l) => `    > ${l}`));
    const n = f.passed_elsewhere ?? 0;
    lines.push(
      n > 0
        ? `  Whether it passed elsewhere: it passed on other commits ${n} ${n === 1 ? 'time' : 'times'} in the last ${PASSED_ELSEWHERE_DAYS} days: possibly environment or flakiness (e.g. a timing threshold on a loaded runner).`
        : `  Whether it passed elsewhere: no passing run on other commits in the last ${PASSED_ELSEWHERE_DAYS} days.`,
    );
  }
  return lines;
}

/** The feedback paragraph for failing CI tests; empty when there are none. */
export function ciFeedbackText(failures: CiFailureDetail[]): string[] {
  return failures.length > 0 ? ['These tests failed in CI:', ...ciFailureLines(failures)] : [];
}
