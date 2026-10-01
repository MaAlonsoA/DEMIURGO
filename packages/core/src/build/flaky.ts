// A test that failed in one CI run and passed in another on the same commit is flaky: it is reported, never ignored.

export const flakyNote = (codes: string[]): string =>
  `${codes.join(', ')} failed in one CI run and passed in another on the same commit: a flaky test must be fixed, not ignored.`;
