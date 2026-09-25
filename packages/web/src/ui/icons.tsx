// Icons. What something is comes from the design system (TypeIcon and its Icon set); the few
// interface icons it doesn't have (chevrons, search, the app's own places) are drawn here the same
// way: stroke icons on the 24 grid, round caps, in currentColor.

import { Icon, type ItemType, TypeIcon as DsTypeIcon } from '@demiurgo/design-system';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.ts';

type IconProps = { size?: number; className?: string };

function Svg({ size = 14, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export type IconKind =
  | 'feature'
  | 'decision'
  | 'tech'
  | 'question'
  | 'check'
  | 'idea'
  | 'thread'
  | 'bug'
  | 'taxonomy'
  | 'package'
  | 'source'
  | 'run'
  | 'knowledge'
  | 'link';

/** The design system's item type of a kind, when it is one. */
export const ITEM_TYPE: Partial<Record<IconKind, ItemType>> = {
  feature: 'feature',
  decision: 'decision',
  tech: 'tech-decision',
  question: 'question',
  check: 'check',
  idea: 'idea',
  thread: 'thread',
  bug: 'bug',
};

/** What something is: the design system's TypeIcon for its types, and the app's own places. */
export function TypeIcon({ kind, size = 14, className }: IconProps & { kind: IconKind }) {
  const type = ITEM_TYPE[kind];
  if (type) {
    const icon = <DsTypeIcon type={type} size={size} />;
    return className ? <span className={cn('inline-flex', className)}>{icon}</span> : icon;
  }
  // Depends on: the design system's signal icon.
  if (kind === 'link') return <Icon name="depends-on" size={size} stroke={2} {...(className ? { className } : {})} />;
  switch (kind) {
    case 'taxonomy':
      return (
        <Svg size={size} {...(className ? { className } : {})}>
          <rect x="9" y="3" width="6" height="5" rx="1" />
          <rect x="3" y="16" width="6" height="5" rx="1" />
          <rect x="15" y="16" width="6" height="5" rx="1" />
          <path d="M12 8v4M6 16v-4h12v4" />
        </Svg>
      );
    case 'package':
      return (
        <Svg size={size} {...(className ? { className } : {})}>
          <path d="M3 7.5l9-4.5 9 4.5v9L12 21l-9-4.5z" />
          <path d="M3 7.5l9 4.5 9-4.5" />
          <path d="M12 12v9" />
        </Svg>
      );
    case 'source':
      return (
        <Svg size={size} {...(className ? { className } : {})}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </Svg>
      );
    case 'run':
      return (
        <Svg size={size} {...(className ? { className } : {})}>
          <circle cx="12" cy="12" r="9" />
          <path d="M10 8.5l5 3.5-5 3.5z" />
        </Svg>
      );
    default:
      return (
        <Svg size={size} {...(className ? { className } : {})}>
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="18" cy="8" r="2.5" />
          <circle cx="9" cy="18" r="2.5" />
          <path d="M8.2 7.2l7.6.6M7 8.3l1.4 7.3M16.5 10l-5.8 6.3" />
        </Svg>
      );
  }
}

export const RECORD_ICON: Record<string, IconKind> = { fdr: 'feature', adr: 'tech', decision: 'decision', bug: 'bug' };

/** The design system's item type of a record. */
export const RECORD_TYPE: Record<string, ItemType> = { fdr: 'feature', adr: 'tech-decision', decision: 'decision', bug: 'bug' };

export function ChevronRight(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 6l6 6-6 6" />
    </Svg>
  );
}

export function ChevronDown(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

export function ChevronLeft(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M15 6l-6 6 6 6" />
    </Svg>
  );
}

export function CloseIcon({ size = 14, className }: IconProps) {
  return <Icon name="close" size={size} stroke={2} {...(className ? { className } : {})} />;
}

export function ArrowRight(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  );
}

/** The design system's Conflict icon: something is wrong or stops an action. */
export function WarningIcon({ size = 14, className }: IconProps) {
  return <Icon name="conflict" size={size} stroke={2} {...(className ? { className } : {})} />;
}

/** The design system's ⓘ. */
export function InfoIcon({ size = 14, className }: IconProps) {
  return <Icon name="info" size={size} stroke={2.4} {...(className ? { className } : {})} />;
}

export function PlusIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function EyeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </Svg>
  );
}

export function LockIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </Svg>
  );
}

export function DashIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 12h14" />
    </Svg>
  );
}

/** A finished step: a tick. */
export function TickIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 12l5 5L20 7" />
    </Svg>
  );
}
