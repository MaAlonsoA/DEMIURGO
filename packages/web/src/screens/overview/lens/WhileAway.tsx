// "While you were away" (DESIGN.md §3.5, INV-LENS-04…11): one line per thing that changed since
// the last visit, in the order the API groups them — when, who, what happened as a link to it, and
// the records it is about. It ends with "Nothing you confirmed was changed." when that is true.
// Nothing on the page is dimmed: changed cards are marked instead (INVENTORY §2 #17).

import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import { Code } from '../../../components/Badge.tsx';
import { Button } from '../../../components/Button.tsx';
import { CheckCircleIcon, HistoryIcon } from '../../../components/icons.tsx';
import { StatusBadge } from '../../../components/status.tsx';
import { DayTime } from '../../../components/Time.tsx';
import { WhoAvatar, whoName } from '../../../components/Who.tsx';
import { cn } from '../../../lib/cn.ts';
import { whoOf } from '../../../words.ts';
import { lineTarget } from './own.ts';
import type { Lens } from './useLens.ts';

export function WhileAway({ projectId, lens }: { projectId: string; lens: Lens }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      data-lens
      className="flex flex-col overflow-hidden rounded-lg border border-accent-edge bg-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-edge bg-accent-soft px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <HistoryIcon size={16} className="shrink-0 text-accent-text" />
          <h2 className="text-base font-semibold text-fg">
            <span id={id}>While you were away</span>
            {lens.since ? (
              <span className="font-normal text-fg-2">
                {' '}
                · since <DayTime iso={lens.since} />
              </span>
            ) : null}
          </h2>
        </div>
        <Button size="sm" variant="quiet" onClick={() => lens.setOn(false)}>
          Show everything
        </Button>
      </div>
      <ol className="flex flex-col divide-y divide-edge-subtle">
        {lens.lines.map((l) => {
          const target = lineTarget(l, lens.things.get(l.id));
          const who = whoOf(l.actor);
          const words = l.segments.map((s, i) =>
            typeof s === 'string' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: segments of one sentence, in order
              <span key={i}>{s}</span>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: segments of one sentence, in order
              <strong key={i} className={cn('font-semibold', target && 'underline decoration-edge-strong underline-offset-2')}>
                {s.strong}
              </strong>
            ),
          );
          return (
            <li key={l.id} data-id={l.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 sm:flex-nowrap">
              <DayTime iso={l.at} className="w-24 shrink-0 pt-0.5 text-xs text-fg-2" />
              <span className="flex min-w-0 flex-1 items-start gap-2">
                <span className="mt-px shrink-0">
                  <WhoAvatar kind={who.kind} size={18} />
                  <span className="sr-only">{whoName(who)}: </span>
                </span>
                <span className="min-w-0 text-sm text-fg">
                  {target ? (
                    <Link
                      to={target.to}
                      params={{ projectId, ...target.params } as never}
                      className="underline-offset-2 hover:text-accent-text hover:underline"
                    >
                      {words}
                    </Link>
                  ) : (
                    words
                  )}
                </span>
              </span>
              {l.problem || l.codes.length > 0 ? (
                <span className="flex shrink-0 flex-wrap items-center gap-2 pl-[108px] sm:pl-0">
                  {l.problem ? <StatusBadge kind="problem" word="A problem" /> : null}
                  {l.codes.map((c) => (
                    <Link
                      key={c}
                      to="/p/$projectId/records/$code"
                      params={{ projectId, code: c }}
                      aria-label={`Open ${c}`}
                      className="rounded-xs px-0.5 hover:underline"
                    >
                      <Code>{c}</Code>
                    </Link>
                  ))}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {lens.nothingConfirmed ? (
        <p className="flex items-center gap-2 border-t border-edge px-4 py-2.5 text-sm text-fg-2">
          <CheckCircleIcon size={15} className="shrink-0 text-success-text" />
          Nothing you confirmed was changed.
        </p>
      ) : null}
    </section>
  );
}
