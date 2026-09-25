// Reasons of a rejected action (409, 422 and 403) and of readiness, in rust, next to the action
// that failed. Never a generic "Error": each status says what happened, with the server's reasons
// as they come. The focus goes to the first reason (spec §7.1).

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

/** A reason that asks the person to choose an engine (FDR-AGE-002): it links to Models & providers. */
const ENGINE_REASON = /Choose (a|another) model for /;

/**
 * Models & providers of the open project, taken from the address (Reasons lives outside the router);
 * outside a project (starting the first one), the workspace's.
 */
function modelsOfCurrentProject(): string {
  const m = typeof window === 'undefined' ? null : /^\/p\/([^/]+)/.exec(window.location.pathname);
  return m ? `/p/${m[1]}/models` : '/models';
}

export function Reasons({ error, className, modelsHref }: { error: unknown; className?: string; modelsHref?: string }) {
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
      className={cn(
        'rounded-[var(--radius-control)] border border-problem-line bg-problem-bg px-3 py-2 text-[13px] text-problem outline-none',
        className,
      )}
    >
      <p className="flex items-start gap-1.5 font-semibold">
        <WarningIcon size={14} className="mt-[3px] shrink-0" />
        <span>{e.title}</span>
      </p>
      {e.reasons.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-6">
          {e.reasons.map((r) => {
            const href = ENGINE_REASON.test(r) ? (modelsHref ?? modelsOfCurrentProject()) : undefined;
            return (
              <li key={r}>
                {r}
                {href && (
                  <>
                    {' '}
                    <a href={href} className="font-semibold underline underline-offset-2">
                      Open Models &amp; providers
                    </a>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Readiness reasons: as the server gives them, with warnings apart (spec §4.5). */
export function ReadinessReasons({ reasons, warnings }: { reasons: string[]; warnings: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      {reasons.length > 0 && (
        <ul className="flex flex-col gap-1.5" data-readiness-reasons>
          {reasons.map((r) => (
            <li key={r} className="flex items-start gap-2 text-[13px] text-ink">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-3" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1.5" data-readiness-warnings>
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-2 text-[13px] text-problem">
              <WarningIcon size={14} className="mt-[3px] shrink-0" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
