// Type icons (canvas S3A, "Icons · what it is") and a few interface icons.

import type { ReactNode } from 'react';

type IconProps = { size?: number; className?: string };

function Svg({ size = 14, className, children, strokeWidth = 2 }: IconProps & { children: ReactNode; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
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

export function TypeIcon({ kind, ...p }: IconProps & { kind: IconKind }) {
  switch (kind) {
    case 'feature':
      return (
        <Svg {...p}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18" />
          <path d="M9 9v11" />
        </Svg>
      );
    case 'decision':
      return (
        <Svg {...p}>
          <path d="M12 3l9 9-9 9-9-9z" />
        </Svg>
      );
    case 'tech':
      return (
        <Svg {...p}>
          <rect x="6" y="6" width="12" height="12" rx="2" />
          <path d="M10 10h4v4h-4z" />
          <path d="M10 2v4M14 2v4M10 18v4M14 18v4M2 10h4M2 14h4M18 10h4M18 14h4" />
        </Svg>
      );
    case 'question':
      return (
        <Svg {...p}>
          <path d="M4 5h16v11H10l-4 4v-4H4z" />
        </Svg>
      );
    case 'check':
      return (
        <Svg {...p}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3.5" />
        </Svg>
      );
    case 'idea':
      return (
        <Svg {...p}>
          <path d="M9 18h6" />
          <path d="M10 21h4" />
          <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" />
        </Svg>
      );
    case 'thread':
      return (
        <Svg {...p}>
          <circle cx="6" cy="5" r="2" />
          <circle cx="6" cy="19" r="2" />
          <circle cx="18" cy="7" r="2" />
          <path d="M6 7v10" />
          <path d="M18 9c0 5-12 3-12 8" />
        </Svg>
      );
    case 'bug':
      return (
        <Svg {...p}>
          <rect x="7" y="7" width="10" height="13" rx="5" />
          <path d="M12 7v13M4 11h3M17 11h3M4 17h3M17 17h3M9 4l1.5 3M15 4l-1.5 3" />
        </Svg>
      );
    case 'taxonomy':
      return (
        <Svg {...p}>
          <rect x="9" y="3" width="6" height="5" rx="1" />
          <rect x="3" y="16" width="6" height="5" rx="1" />
          <rect x="15" y="16" width="6" height="5" rx="1" />
          <path d="M12 8v4M6 16v-4h12v4" />
        </Svg>
      );
    case 'package':
      return (
        <Svg {...p}>
          <path d="M3 7.5l9-4.5 9 4.5v9L12 21l-9-4.5z" />
          <path d="M3 7.5l9 4.5 9-4.5" />
          <path d="M12 12v9" />
        </Svg>
      );
    case 'source':
      return (
        <Svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </Svg>
      );
    case 'run':
      return (
        <Svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M10 8.5l5 3.5-5 3.5z" />
        </Svg>
      );
    case 'knowledge':
      return (
        <Svg {...p}>
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="18" cy="8" r="2.5" />
          <circle cx="9" cy="18" r="2.5" />
          <path d="M8.2 7.2l7.6.6M7 8.3l1.4 7.3M16.5 10l-5.8 6.3" />
        </Svg>
      );
    case 'link':
      return (
        <Svg {...p}>
          <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
          <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
        </Svg>
      );
  }
}

export const RECORD_ICON: Record<string, IconKind> = { fdr: 'feature', adr: 'tech', decision: 'decision', bug: 'bug' };

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

export function CloseIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function ArrowRight(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  );
}

export function WarningIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3l9.5 17h-19z" />
      <path d="M12 10v4" />
      <path d="M12 17.5v.01" />
    </Svg>
  );
}

export function InfoIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.01" />
    </Svg>
  );
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
