// Notices (DESIGN.md §5, §6.6). Inline notices persist until their cause is gone (R41); the error
// notice says what happened in product words, lists the server's reasons as they come, keeps a
// Retry close by, and — for a missing engine — links to Models & providers without reloading the
// page (the old full-page link lost the New project form). A banner is page-level (degraded
// states, R76).

import { Link, useParams } from '@tanstack/react-router';
import { type ReactNode, useEffect, useRef } from 'react';
import { cn } from '../lib/cn.ts';
import { Button } from './Button.tsx';
import { ENGINE_REASON, explain } from './explain.ts';
import { AlertCircleIcon, AlertTriangleIcon, CheckCircleIcon, InfoIcon, RetryIcon, XCircleIcon } from './icons.tsx';
import { TONE, type Tone } from './status.tsx';

type NoticeTone = Extract<Tone, 'info' | 'success' | 'warning' | 'danger' | 'neutral' | 'accent'>;

const ICON: Record<NoticeTone, typeof InfoIcon> = {
  info: InfoIcon,
  neutral: InfoIcon,
  accent: InfoIcon,
  success: CheckCircleIcon,
  warning: AlertTriangleIcon,
  danger: XCircleIcon,
};

/** An inline message in a tone: a title, an optional body and an action. */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
  className,
  role,
  icon,
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  role?: 'status' | 'alert';
  icon?: ReactNode | false;
}) {
  const t = TONE[tone];
  const Icon = ICON[tone];
  return (
    <div
      role={role}
      className={cn('flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-base', t.soft, t.edge, className)}
    >
      {icon === false ? null : (icon ?? <Icon size={16} className={cn('mt-0.5 shrink-0', t.icon)} />)}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? <p className={cn('font-medium', tone === 'neutral' ? 'text-fg' : t.text)}>{title}</p> : null}
        {children ? <div className="text-fg-2">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}

/**
 * The explanation of a failed query or action, next to it. `role="alert"`; it takes the focus when
 * it appears unless `focus={false}` (inside a combobox or a popover, where moving focus would close
 * the very thing that shows it). `onRetry` adds a Retry button.
 */
export function ErrorNotice({
  error,
  className,
  onRetry,
  focus = true,
  compact,
}: {
  error: unknown;
  className?: string;
  onRetry?: () => void;
  focus?: boolean;
  compact?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const params = useParams({ strict: false }) as { projectId?: string };
  useEffect(() => {
    if (error && focus) ref.current?.focus();
  }, [error, focus]);
  if (!error) return null;
  const e = explain(error);
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      data-reasons
      className={cn(
        'flex items-start gap-2.5 rounded-lg border border-danger-edge bg-danger-soft text-danger-text outline-none',
        compact ? 'px-3 py-2 text-sm' : 'px-3.5 py-3 text-base',
        className,
      )}
    >
      <AlertCircleIcon size={16} className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-medium">{e.title}</p>
        {e.reasons.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-fg">
            {e.reasons.map((r) => (
              <li key={r}>
                {r}
                {ENGINE_REASON.test(r) ? (
                  <>
                    {' '}
                    {params.projectId ? (
                      <Link
                        to="/p/$projectId/models"
                        params={{ projectId: params.projectId }}
                        className="font-medium text-accent-text underline underline-offset-2"
                      >
                        Open Models &amp; providers
                      </Link>
                    ) : (
                      <Link to="/models" className="font-medium text-accent-text underline underline-offset-2">
                        Open Models &amp; providers
                      </Link>
                    )}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      {onRetry ? (
        <Button size="sm" variant="secondary" icon={<RetryIcon size={14} />} onClick={onRetry} className="self-center">
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/** A page-level band (connection lost, a degraded page). Sticky at the top of the main panel. */
export function Banner({
  tone = 'warning',
  children,
  action,
  className,
}: {
  tone?: NoticeTone;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  const Icon = ICON[tone];
  return (
    <div role="status" className={cn('flex items-center gap-2.5 border-b px-4 py-2 text-sm', t.soft, t.edge, className)}>
      <Icon size={16} className={cn('shrink-0', t.icon)} />
      <p className="min-w-0 flex-1 text-fg">{children}</p>
      {action}
    </div>
  );
}
