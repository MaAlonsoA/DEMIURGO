// Loading feedback (DESIGN.md §5): a spinner only for the person's own action in flight (R45); a
// skeleton shaped like the content for a view's first load, shown after 300 ms so fast loads never
// flash (R54, R55). Agent runs are never "loading": they have their own status (status.tsx).

import { type CSSProperties, useEffect, useState } from 'react';
import { cn } from '../lib/cn.ts';

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      focusable="false"
      className={cn('shrink-0 animate-spin', className)}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** True once `ms` have passed: skeletons wait a moment before showing. */
export function useDelayed(ms = 300): boolean {
  const [shown, setShown] = useState(ms <= 0);
  useEffect(() => {
    if (ms <= 0) return;
    const t = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return shown;
}

/** One grey block of the skeleton. */
export function Bone({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={cn('block animate-pulse rounded-xs bg-hover', className)} style={style} />;
}

/**
 * A skeleton region: `role="status"` with a label says what is loading; the bones are decorative.
 * Nothing shows for the first 300 ms.
 */
export function Skeleton({
  label,
  children,
  className,
  delay = 300,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const shown = useDelayed(delay);
  return (
    <div role="status" aria-label={label} className={className}>
      <span className="sr-only">{label}</span>
      {shown ? children : null}
    </div>
  );
}

/** A list of skeleton rows (a table or a list's first load). */
export function RowsSkeleton({ label, rows = 4, className }: { label: string; rows?: number; className?: string }) {
  return (
    <Skeleton label={label} className={className}>
      <div className="flex flex-col divide-y divide-edge-subtle">
        {Array.from({ length: rows }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows
          <div key={i} className="flex items-center gap-3 py-3">
            <Bone className="h-4 w-4 rounded-full" />
            <Bone className="h-3.5" style={{ width: `${55 - (i % 3) * 12}%` }} />
            <Bone className="ml-auto h-3 w-16" />
          </div>
        ))}
      </div>
    </Skeleton>
  );
}

/** A page's first load: a title and a few blocks of content. */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <Skeleton label={label} className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Bone className="h-3 w-32" />
        <Bone className="h-6 w-2/3" />
        <Bone className="h-3 w-1/2" />
      </div>
      <div className="flex flex-col gap-3">
        <Bone className="h-24 w-full rounded-lg" />
        <Bone className="h-24 w-full rounded-lg" />
      </div>
    </Skeleton>
  );
}
