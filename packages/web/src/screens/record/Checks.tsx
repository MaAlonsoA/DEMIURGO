// The checks of a version (its acceptance criteria), each as the design system's CheckRow: title,
// statement, how it is checked and who checks it ("Automatic" or "You"), with the verifiability
// warning in place of the statement when the readiness cites it.

import { CheckRow } from '@demiurgo/design-system';
import { useId } from 'react';
import type { Criterion, Readiness } from '../../api/types.ts';
import { useLegendMark } from '../../ui/legend-store.ts';
import { WhoGlyph } from '../../ui/signals.tsx';
import { Tip } from '../../ui/Tip.tsx';
import { warningsOf } from './logic.ts';

/** Who checks it: a test on its own (Automatic) or the person by hand (You). */
export function VerificationMark({ verification }: { verification: string }) {
  const kind = verification === 'manual' ? 'you' : 'automatic';
  useLegendMark(`who:${kind}`);
  const label = kind === 'you' ? 'You' : 'Automatic';
  const phrase = kind === 'you' ? 'You check it by hand once it is built.' : 'A test checks it on its own.';
  return (
    <Tip text={`${label} · ${phrase}`}>
      <span className="dm-text-caption inline-flex items-center gap-1.5 font-medium text-ink-2">
        <span role="img" aria-label={`Checked by: ${label}`} data-who={kind} className="inline-flex">
          <WhoGlyph kind={kind} size={18} />
        </span>
        {label}
      </span>
    </Tip>
  );
}

export function Checks({ criteria, readiness }: { criteria: Criterion[]; readiness: Readiness | null }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2.5">
      <h2 id={id} className="dm-text-caption font-semibold text-muted">
        Checks <span className="font-normal text-muted">· {criteria.length}</span>
      </h2>
      {criteria.length === 0 ? (
        <p className="dm-text-small rounded-card-md border border-dashed border-line-strong px-4 py-5 text-center text-muted">
          This version has no checks yet.
        </p>
      ) : (
        <ol className="grid grid-cols-2 gap-3">
          {criteria.map((c) => {
            const warnings = warningsOf(c.code, readiness);
            return (
              <li key={c.id} data-check={c.code} className="min-w-0 rounded-card-md border border-line bg-surface px-4 py-3">
                {/* The statement stays; its verifiability warnings go under it (data-verifiability). */}
                <div data-verifiability={warnings.length > 0 ? '' : undefined}>
                  <CheckRow
                    title={c.title}
                    statement={c.statement}
                    verifiedBy={c.verification === 'manual' ? 'you' : 'automatic'}
                    how={`How: ${c.check}`}
                    code={c.code}
                    warnings={warnings}
                    whoMark={<VerificationMark verification={c.verification} />}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
