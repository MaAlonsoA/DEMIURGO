// Reasons of a rejected action (409, 422 and 403) and of readiness, in rust, next to the action
// that failed. Never a generic "Error": each status says what happened, with the server's reasons
// as they come. The focus goes to the first reason (spec §7.1).

import { Readiness, type ReadinessItem } from '@demiurgo/design-system';
import { useEffect, useRef } from 'react';
import { ApiError } from '../api/client.ts';
import { cn } from '../lib/cn.ts';
import { PRODUCT_WORDS } from '../words.ts';
import { WarningIcon } from './icons.tsx';

export type Explained = { title: string; reasons: string[] };

const KNOWLEDGE_BEHIND = /knowledge is not up to date|knowledge.*not.*current/i;

/** What an error means in product words: a title and the reasons to show under it. */
export function explain(error: unknown): Explained {
  if (!(error instanceof ApiError)) {
    return { title: 'Something went wrong on our side. Nothing was changed.', reasons: [] };
  }
  const reasons = error.reasons.length > 0 ? error.reasons : error.message ? [error.message] : [];
  switch (error.status) {
    case 0:
      return { title: "Can't reach DEMIURGO. Check your connection and try again.", reasons: [] };
    case 401:
      return { title: 'Your session ended. Sign in again to continue.', reasons: [] };
    case 403:
      return {
        title: /person|human/i.test(error.message) ? PRODUCT_WORDS.onlyAPerson : PRODUCT_WORDS.notAllowed,
        reasons: [error.message],
      };
    case 404:
      return { title: `We couldn't find it. ${error.message}`.trim(), reasons: [] };
    case 409:
      if ([error.message, ...error.reasons].some((r) => KNOWLEDGE_BEHIND.test(r))) {
        return { title: PRODUCT_WORDS.catchingUp, reasons: error.reasons.length ? error.reasons : [error.message] };
      }
      return {
        title: error.reasons.length ? error.message : "It can't be done right now.",
        reasons: error.reasons.length ? error.reasons : [error.message],
      };
    case 422:
      return { title: 'Some of what you wrote needs a change.', reasons };
    default:
      return { title: 'Something went wrong on our side. Nothing was changed.', reasons: error.message ? [error.message] : [] };
  }
}

export function Reasons({ error, className }: { error: unknown; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  if (!error) return null;
  const e = explain(error);
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      data-reasons
      className={cn('dm-text-small rounded-control bg-problem-tint px-3 py-2 text-problem outline-none', className)}
    >
      <p className="flex items-start gap-1.5 font-semibold">
        <WarningIcon size={14} className="mt-[3px] shrink-0" />
        <span>{e.title}</span>
      </p>
      {e.reasons.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-6">
          {e.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Readiness as the design system's Readiness: the server's reasons as they come, each on its line
    (data-kind="reason"), and the warnings apart (data-kind="warning"), which never block (spec §4.5). */
export function ReadinessBox({
  reasons,
  warnings,
  next,
  track,
}: {
  reasons: string[];
  warnings: string[];
  /** What to do next once it is ready. */
  next?: string;
  /** The ready track: false when the screen shows the stage elsewhere. */
  track?: false;
}) {
  const items: ReadinessItem[] = [
    ...reasons.map((text) => ({ text, kind: 'reason' as const })),
    ...warnings.map((text) => ({ text, kind: 'warning' as const })),
  ];
  return <Readiness items={items} width="100%" {...(next ? { next } : {})} {...(track === false ? { track } : {})} />;
}
