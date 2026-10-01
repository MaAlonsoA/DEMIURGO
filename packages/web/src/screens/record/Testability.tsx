// Jev's warnings on a task's criteria (H97): one sober line per criterion the builder cannot satisfy
// with an automated test in CI. A warning only: nothing is blocked and the person decides.

import type { TestabilityFlag } from '../../api/types.ts';
import { type Translation, useMessages } from '../../i18n/define.ts';
import { TESTABILITY } from './words.i18n.ts';

type Words = Translation<typeof TESTABILITY.en>;

/** The line of a flag: the kind of problem Jev's Choice named, or the generic wording for older opinions. */
function lineOf(t: Words, f: TestabilityFlag): string {
  const p = f.probability.toFixed(2);
  if (f.kind === 'waits_for_feature') return t.waits(f.code, p);
  if (f.needs === 'needs_production') return t.untestableProduction(f.code, p);
  if (f.needs === 'needs_person') return t.untestablePerson(f.code, p);
  return t.untestable(f.code, p);
}

export function TestabilityLines({ flags }: { flags: readonly TestabilityFlag[] | null | undefined }) {
  const t = useMessages(TESTABILITY);
  if (!flags || flags.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1" data-testability>
      {flags.map((f) => (
        <li key={f.code} className="max-w-prose text-sm text-fg" data-testability-kind={f.kind}>
          {lineOf(t, f)}
        </li>
      ))}
    </ul>
  );
}
