// "While you were away" (canvas S6A): the design system's WhileAway, one line per thing since the
// last visit (data-id), with who did it and when (and the codes it touched, as in a panel), ending with
// "Nothing you confirmed was changed." when it is true. "Show everything" turns the lens off.

import { WhileAway as DsWhileAway } from '@demiurgo/design-system';
import { useId } from 'react';
import { dayTime } from '../../../lib/time.ts';
import { Code } from '../../../ui/Card.tsx';
import { Mark } from '../../../ui/marks.tsx';
import { WhoMark } from '../../../ui/signals.tsx';
import { whoOf } from '../../../words.ts';
import type { Lens } from './useLens.ts';

export function WhileAway({ lens }: { lens: Lens }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mb-7">
      <DsWhileAway
        width="100%"
        title={
          <span id={id}>
            While you were away
            {lens.since && <span className="font-normal text-muted"> · since {lens.since}</span>}
          </span>
        }
        onShowAll={() => lens.setOn(false)}
        items={lens.lines.map((l) => ({
          id: l.id,
          time: dayTime(l.at),
          who: whoOf(l.actor).kind,
          whoMark: <WhoMark actor={l.actor} size={18} />,
          text: l.segments.map((s, i) =>
            typeof s === 'string' ? (
              <span key={i}>{s}</span>
            ) : (
              <strong key={i} className="font-semibold">
                {s.strong}
              </strong>
            ),
          ),
          trailing:
            l.problem || l.codes.length > 0 ? (
              <span className="flex items-center gap-2">
                {l.problem && <Mark kind="conflict" label="A problem" />}
                {l.codes.map((c) => (
                  <Code key={c}>{c}</Code>
                ))}
              </span>
            ) : undefined,
        }))}
        note={lens.nothingConfirmed ? 'Nothing you confirmed was changed.' : undefined}
      />
    </section>
  );
}
