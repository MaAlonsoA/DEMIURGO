// The checks of a version (its acceptance criteria): title, statement, who checks it ("Automatic"
// or "You") and how, with the verifiability warning when the readiness cites it.

import { useId } from 'react';
import type { Criterion, Readiness } from '../../api/types.ts';
import { Code } from '../../ui/Card.tsx';
import { TypeIcon, WarningIcon } from '../../ui/icons.tsx';
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
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-2">
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
      <h2 id={id} className="text-xs font-semibold text-muted">
        Checks <span className="font-normal text-muted">· {criteria.length}</span>
      </h2>
      {criteria.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-5 text-center text-[13px] text-muted">
          This version has no checks yet.
        </p>
      ) : (
        <ol className="grid grid-cols-2 gap-3">
          {criteria.map((c, i) => {
            const warnings = warningsOf(c.code, readiness);
            return (
              <li
                key={c.id}
                data-check={c.code}
                className="flex min-w-0 flex-col gap-1.5 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3"
              >
                <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
                  <TypeIcon kind="check" size={13} />
                  Check {i + 1}
                  <Code className="ml-auto tracking-normal normal-case">{c.code}</Code>
                </span>
                <strong className="text-[14px] leading-snug font-semibold">{c.title}</strong>
                <p className="text-[13px] leading-relaxed text-ink-2">{c.statement}</p>
                {warnings.length > 0 && (
                  <ul className="flex flex-col gap-1" data-verifiability>
                    {warnings.map((w) => (
                      <li key={w} className="flex items-start gap-1.5 text-xs text-problem">
                        <WarningIcon size={13} className="mt-[2px] shrink-0" />
                        {w}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-auto flex items-start justify-between gap-3 border-t border-line-soft pt-2">
                  <p className="min-w-0 text-xs text-ink-3">
                    <span className="font-semibold text-muted">How: </span>
                    {c.check}
                  </p>
                  <span className="shrink-0">
                    <VerificationMark verification={c.verification} />
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
