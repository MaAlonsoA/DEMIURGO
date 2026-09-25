// The checks of a version (its acceptance criteria; DESIGN.md §3.6, INV-REC-17, INV-BP-28): one row
// each, in a single column so long Given/When/Then statements read comfortably — title, statement,
// how it is checked, who checks it (Automatic or You, in words) and its code, with the verifiability
// warnings of the readiness under the statement.

import { useId } from 'react';
import type { Criterion, Readiness } from '../../api/types.ts';
import { Code } from '../../components/Badge.tsx';
import { AlertTriangleIcon } from '../../components/icons.tsx';
import { WhoAvatar } from '../../components/Who.tsx';
import { cn } from '../../lib/cn.ts';
import { warningsOf } from './logic.ts';

/** Who checks it: a test on its own (Automatic) or the person by hand (You), in words. */
export function VerificationMark({ verification, className }: { verification: string; className?: string }) {
  const you = verification === 'manual';
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs text-fg-2', className)}
      title={you ? 'You check it by hand once it is built.' : 'A test checks it on its own.'}
    >
      <WhoAvatar kind={you ? 'you' : 'automatic'} size={16} />
      <span>
        Checked by: <span className="font-medium text-fg">{you ? 'You' : 'Automatic'}</span>
      </span>
    </span>
  );
}

export function CheckList({ criteria, readiness }: { criteria: Criterion[]; readiness: Readiness | null }) {
  if (criteria.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-edge-strong px-4 py-6 text-center text-sm text-fg-2">
        This version has no checks yet.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-3">
      {criteria.map((c) => {
        const warnings = warningsOf(c.code, readiness);
        return (
          <li key={c.id} data-check={c.code} className="flex flex-col gap-2 rounded-lg border border-edge bg-panel px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="text-base font-semibold text-fg">{c.title}</h3>
              <Code>{c.code}</Code>
            </div>
            <p className="text-md text-fg">{c.statement}</p>
            {warnings.length > 0 ? (
              <div
                data-verifiability
                className="flex items-start gap-2 rounded-md border border-warning-edge bg-warning-soft px-3 py-2 text-sm text-fg"
              >
                <AlertTriangleIcon size={14} className="mt-0.5 shrink-0 text-warning-text" />
                <ul className="flex flex-col gap-0.5">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-edge-subtle pt-2 text-sm text-fg-2">
              <span>
                <span className="font-medium text-fg">How: </span>
                {c.check}
              </span>
              <VerificationMark verification={c.verification} className="ml-auto" />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** The checks with their heading, as a section of the record's overview or its own tab. */
export function Checks({
  criteria,
  readiness,
  level = 2,
}: {
  criteria: Criterion[];
  readiness: Readiness | null;
  level?: 2 | 3;
}) {
  const id = useId();
  const H = level === 3 ? 'h3' : 'h2';
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <H id={id} className="text-lg font-semibold text-fg">
        Checks <span className="font-normal text-fg-2">· {criteria.length}</span>
      </H>
      <CheckList criteria={criteria} readiness={readiness} />
    </section>
  );
}
