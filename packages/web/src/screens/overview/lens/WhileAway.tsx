// "While you were away" (canvas S6A): one line per thing since the last visit, with who did it
// and when, ending with "Nothing you confirmed was changed." when it is true.

import { useId } from 'react';
import { dayTime } from '../../../lib/time.ts';
import { Button } from '../../../ui/Button.tsx';
import { Code } from '../../../ui/Card.tsx';
import { EyeIcon } from '../../../ui/icons.tsx';
import { Mark } from '../../../ui/marks.tsx';
import { WhoMark } from '../../../ui/signals.tsx';
import type { Lens } from './useLens.ts';

export function WhileAway({ lens }: { lens: Lens }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="mb-7 flex flex-col gap-1 rounded-[var(--radius-panel)] border border-line bg-surface px-5 pt-3.5 pb-3"
    >
      <div className="mb-1 flex items-center justify-between gap-4">
        <h2 id={id} className="text-[15px] font-semibold">
          While you were away
          {lens.since && <span className="font-normal text-muted"> · since {lens.since}</span>}
        </h2>
        <Button variant="ghost" size="sm" onClick={() => lens.setOn(false)}>
          <EyeIcon size={14} />
          Show everything
        </Button>
      </div>
      <ul className="flex flex-col">
        {lens.lines.map((l) => (
          <li
            key={l.id}
            data-lens-line={l.id}
            className="-mx-2 grid grid-cols-[76px_18px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2 py-[5px] text-[13.5px] hover:bg-surface-2"
          >
            <span className="text-xs whitespace-nowrap text-muted">{dayTime(l.at)}</span>
            <WhoMark actor={l.actor} size={18} />
            <span className="min-w-0">
              {l.segments.map((s, i) =>
                typeof s === 'string' ? (
                  <span key={i}>{s}</span>
                ) : (
                  <strong key={i} className="font-semibold">
                    {s.strong}
                  </strong>
                ),
              )}
            </span>
            <span className="flex items-center gap-2">
              {l.problem && <Mark kind="conflict" size={10} label="A problem" />}
              {l.codes.map((c) => (
                <Code key={c}>{c}</Code>
              ))}
            </span>
          </li>
        ))}
        {lens.nothingConfirmed && (
          <li className="-mx-2 grid grid-cols-[76px_18px_minmax(0,1fr)_auto] items-center gap-2.5 px-2 py-[5px] text-[13.5px] text-ink-3">
            <span />
            <span />
            <span>Nothing you confirmed was changed.</span>
            <span />
          </li>
        )}
      </ul>
    </section>
  );
}
