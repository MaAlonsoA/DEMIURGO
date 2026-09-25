// "What it touches", the other way (FDR-INT-002, canvas S5A): what connects to a record. The links
// of the other records' shown version that point to it, in the words the map uses from this end
// ("Needed by", "Followed by", "Conflicts with", "Affected by"). Links the map doesn't draw (where
// something comes from, what a check covers) aren't connections and don't show here.

import { Link } from '@tanstack/react-router';
import type { IncomingLink } from '../../api/types.ts';
import { Code } from '../../ui/Card.tsx';
import { Mark } from '../../ui/marks.tsx';
import { stateWord } from '../../words.ts';
import { relationWord } from '../map/layout.ts';

export function IncomingLinks({ projectId, links }: { projectId: string; links: readonly IncomingLink[] }) {
  const shown = links.filter((l): l is IncomingLink & { relation: NonNullable<IncomingLink['relation']> } => l.relation !== null);
  if (shown.length === 0) return null;
  return (
    <ul data-incoming className="flex flex-col gap-1">
      {shown.map((l) => {
        const w = stateWord('link', l.state);
        return (
          <li key={l.id} data-incoming-from={l.from_code} className="flex items-start gap-2 text-[13px]">
            <span className="mt-[5px] flex">
              <Mark kind={w.mark} size={9} label={`Link: ${w.word}`} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span>
                <span className="text-muted">{relationWord(l.relation, 'to')} </span>
                <Link
                  to="/p/$projectId/records/$code"
                  params={{ projectId, code: l.from_code }}
                  search={{ v: l.from_n }}
                  className="font-medium text-ink hover:text-needs"
                >
                  {l.from_title}
                </Link>
              </span>
              <Code>
                {l.from_code} v{l.from_n} · to v{l.to_n}
              </Code>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
