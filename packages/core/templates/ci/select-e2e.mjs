// Chooses which end-to-end tests a CI run executes. Plain Node ESM, no dependencies.
//
// Practice: presubmit runs the tests affected by the change, postsubmit runs everything (Google TAP,
// "Software Engineering at Google", ch. 23). Selecting by criterion code through the `Affected-criteria`
// commit trailer is a DEMIURGO convention (git trailers: git-scm.com/docs/git-interpret-trailers).
//
// - pull_request: runs the tests of the criteria in the trailer of the pull request's head commit (test
//   titles start with their criterion code). Without a trailer it runs the changed specs when only specs,
//   unit tests and documentation changed, and the whole suite otherwise.
// - push to main (or anything else): the whole suite.
//
// Prints the arguments for `playwright test` on stdout and the decision on stderr. No argument holds a
// space, so pass the line through an environment variable and expand it unquoted:
//   E2E_ARGS: ${{ steps.scope.outputs.args }}   ->   pnpm exec playwright test $E2E_ARGS
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const TRAILER = 'Affected-criteria';
/** A criterion code such as AC-ESQ-001-01 (DEMIURGO's format). */
export const CRITERION = /^[A-Z]+-[A-Z]+-\d+-\d+$/;
// Specs, unit tests and documentation: nothing here changes what the application does.
export const TESTS_AND_DOCS = /^(.*\.(spec|test)\.[cm]?[jt]sx?|(.*\/)?(__tests__|e2e|tests?)\/.*\.[cm]?[jt]sx?|design\/.*|docs?\/.*|\.demiurgo\/.*|.*\.mdx?)$/;

/** The valid criterion codes among the values of the trailers, without repeats, in order. */
export function affectedCriteria(trailerValues) {
  return [...new Set(String(trailerValues).split(/\s+/).filter((token) => CRITERION.test(token)))];
}

/** Pure. { args: string[], reason: string } */
export function selectEndToEnd({ event, changedFiles, trailerValues }) {
  if (event !== 'pull_request') return { args: [], reason: 'not a pull request: the whole suite' };
  const codes = affectedCriteria(trailerValues);
  if (codes.length > 0) {
    // Playwright matches --grep against the project, file and titles joined by spaces, so the code is
    // looked for as a whole word anywhere in it, not anchored to the start.
    // A criterion with no end-to-end test (checked below that level) selects nothing: the run passes.
    return {
      args: [`--grep=(?<![\\w-])(?:${codes.join('|')})(?![\\w-])`, '--pass-with-no-tests'],
      reason: `${codes.length} affected criteria: ${codes.join(', ')}`,
    };
  }
  if (changedFiles.length > 0 && changedFiles.every((file) => TESTS_AND_DOCS.test(file))) {
    return {
      args: ['--only-changed=origin/main', '--pass-with-no-tests'],
      reason: `no ${TRAILER} trailer on the head commit; only tests and documentation changed: the changed specs`,
    };
  }
  return { args: [], reason: `no ${TRAILER} trailer on the head commit; application code (or unknown changes): the whole suite` };
}

/** The values of the git trailers `Affected-criteria` of a commit (text in the body is not a trailer). */
export function readTrailerValues(commit) {
  return execFileSync('git', ['log', '-1', `--format=%(trailers:key=${TRAILER},valueonly,unfold)`, commit], { encoding: 'utf8' });
}

function changedFilesAgainst(base) {
  try {
    return execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function main() {
  const event = process.env.GITHUB_EVENT_NAME ?? '';
  if (event !== 'pull_request') {
    console.error(`End-to-end scope: ${selectEndToEnd({ event, changedFiles: [], trailerValues: '' }).reason}`);
    console.log('');
    return;
  }
  // On a pull request the checkout is a merge commit: the pull request's own head is passed in.
  const head = process.env.PR_HEAD_SHA || 'HEAD';
  let trailerValues = '';
  try {
    trailerValues = readTrailerValues(head);
  } catch (error) {
    console.error(`End-to-end scope: cannot read ${head} (fetch-depth too small?): ${error instanceof Error ? error.message : String(error)}`);
  }
  const changedFiles = changedFilesAgainst(process.env.E2E_BASE_REF || 'origin/main');
  const { args, reason } = selectEndToEnd({ event, changedFiles, trailerValues });
  console.error(`End-to-end scope: ${reason}`);
  console.log(args.join(' '));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
