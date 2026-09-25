// "What it touches", the other way (INV-REC-21, AC-INT-002-08): what connects to a record — the links
// of the other records' shown version that point to it, in the words the map uses from this end
// ("Needed by", "Followed by", "Conflicts with", "Affected by"). Links the map doesn't draw (where
// something comes from, what a check covers) aren't connections and don't show here.

import { Link } from '@tanstack/react-router';
import type { IncomingLink } from '../../api/types.ts';
import { Code } from '../../components/Badge.tsx';
import { EntityState } from '../../components/status.tsx';
import { relationWord } from '../map/layout.ts';

export function IncomingLinks({ projectId, links }: { projectId: string; links: readonly IncomingLink[] }) {
  const shown = links.filter((l): l is IncomingLink & { relation: NonNullable<IncomingLink['relation']> } => l.relation !== null);
  if (shown.length === 0) return null;
  return (
    <ul data-incoming className="flex flex-col gap-2">
      {shown.map((l) => (
        <li key={l.id} data-incoming-from={l.from_code} className="flex flex-col gap-0.5 text-sm">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="text-fg-2">{relationWord(l.relation, 'to')}</span>
            <Link
              to="/p/$projectId/records/$code"
              params={{ projectId, code: l.from_code }}
              search={{ v: l.from_n }}
              className="font-medium text-accent-text hover:underline"
            >
              {l.from_title}
            </Link>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Code>
              {l.from_code} v{l.from_n} · to v{l.to_n}
            </Code>
            <EntityState entity="link" state={l.state} />
          </span>
        </li>
      ))}
    </ul>
  );
}
