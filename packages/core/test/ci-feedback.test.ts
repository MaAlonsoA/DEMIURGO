// The feedback text a red CI gives the next build attempt, and the JUnit failure reader behind it.

import { describe, expect, it } from 'vitest';
import { ciFeedbackText } from '../src/build/ci-feedback.ts';
import { failuresOf, parseJunit } from '../src/commands/evidence.ts';

describe('ci feedback', () => {
  it('words each failing test with code, title, file, quoted message and whether it passed elsewhere', () => {
    const lines = ciFeedbackText([
      { code: 'AC-MEA-005-10', test: 'AC-MEA-005-10 p95 is under 2 s', file: 'packages/api/test/perf.test.ts', message: 'expected 2400 to be less than 2000', passed_elsewhere: 3 },
      { code: null, test: 'plain test', file: null, message: 'a\nb' },
    ]);
    const text = lines.join('\n');
    expect(lines[0]).toBe('These tests failed in CI:');
    expect(text).toContain('- AC-MEA-005-10: AC-MEA-005-10 p95 is under 2 s (packages/api/test/perf.test.ts)');
    expect(text).toContain('    > expected 2400 to be less than 2000');
    expect(text).toContain('Whether it passed elsewhere: it passed on other commits 3 times in the last 7 days: possibly environment or flakiness');
    expect(text).toContain('- plain test\n');
    expect(text).toContain('    > a\n    > b');
    expect(text).toContain('no passing run on other commits');
    expect(ciFeedbackText([])).toEqual([]);
  });

  it('reads message and text of failure and error children, capped', () => {
    const xml = `<testsuite>
<testcase classname="f.test.ts" name="AC-AAA-001-01 x"><failure message="m &amp; n">stack &lt;here&gt;</failure></testcase>
<testcase classname="g.test.ts" name="no code"><error message="crash"/></testcase>
<testcase classname="h.test.ts" name="long"><failure>${'z'.repeat(5000)}</failure></testcase>
<testcase classname="h.test.ts" name="fine"/>
</testsuite>`;
    const failures = failuresOf(parseJunit(xml));
    expect(failures.map((f) => f.code)).toEqual(['AC-AAA-001-01', null, null]);
    expect(failures[0]).toMatchObject({ file: 'f.test.ts', message: 'm & n\nstack <here>' });
    expect(failures[1]!.message).toBe('crash');
    expect(failures[2]!.message.length).toBe(1500);
  });
});
