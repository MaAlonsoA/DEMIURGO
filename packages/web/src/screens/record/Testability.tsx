// Jev's warnings on a task's criteria (H97): one sober line per criterion the builder cannot satisfy
// with an automated test in CI. A warning only: nothing is blocked and the person decides.

import type { TestabilityFlag } from '../../api/types.ts';
import { useMessages } from '../../i18n/define.ts';
import { TESTABILITY } from './words.i18n.ts';

export function TestabilityLines({ flags }: { flags: readonly TestabilityFlag[] | null | undefined }) {
  const t = useMessages(TESTABILITY);
  if (!flags || flags.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1" data-testability>
      {flags.map((f) => (
        <li key={f.code} className="max-w-prose text-sm text-fg" data-testability-kind={f.kind}>
          {f.kind === 'untestable' ? t.untestable(f.code, f.probability.toFixed(2)) : t.waits(f.code, f.probability.toFixed(2))}
        </li>
      ))}
    </ul>
  );
}
