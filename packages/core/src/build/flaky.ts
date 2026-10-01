// A test that failed in one CI run and passed in another on the same commit is flaky: it is reported, never ignored.

export const flakyNote = (codes: string[]): string =>
  `${codes.join(', ')} failed in one CI run and passed in another on the same commit: a flaky test must be fixed, not ignored.`;

/**
 * Quarantine (Martin Fowler, "Eradicating Non-Determinism in Tests": quarantine the flaky test so it stops blocking
 * the line, and fix it soon). A flaky test (failed in one run, passed in another on the same commit) outside the
 * task's own criteria does not block this pull request: it is recorded and someone creates a fix task. One that
 * covers a criterion of the task still blocks (the builder must fix it), and so does any test that failed in every
 * run it ran in (`stableFailures`): then the red CI is not explained by flakiness.
 */
export function quarantineOf(input: { flaky: string[]; covers: string[]; stableFailures: number }): { quarantined: string[]; own: string[]; forgiven: boolean } {
  const own = input.flaky.filter((c) => input.covers.includes(c));
  const quarantined = input.flaky.filter((c) => !input.covers.includes(c));
  return { quarantined, own, forgiven: quarantined.length > 0 && own.length === 0 && input.stableFailures === 0 };
}

export const quarantineNote = (tests: string[]): string => `Quarantined flaky tests: ${tests.join(', ')}.`;
