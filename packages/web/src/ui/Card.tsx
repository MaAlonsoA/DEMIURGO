// The detail size of the card template (canvas S3B) is the design system's Panel: when an element
// is selected (the peek and the pinned panel), with the zones in the same order as the card. The
// card and node sizes are the design system's FeatureCard and Node.

import { Panel } from '@demiurgo/design-system';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { type IconKind, TypeIcon } from './icons.tsx';

export type DetailProps = {
  icon: IconKind;
  type: string;
  status?: ReactNode;
  bars?: ReactNode;
  title: string;
  line?: ReactNode;
  who?: ReactNode;
  /** Record code and version: codes only in the detail, small, in the code style. */
  code?: string;
  actions?: ReactNode;
  /** Floating: the peek beside a pointed card. */
  floating?: boolean;
  children?: ReactNode;
};

/** Detail size: when an element is selected (the peek and the pinned panel). */
export function Detail(p: DetailProps) {
  return (
    <Panel width="100%" floating={p.floating ?? false}>
      <span className="flex items-center justify-between gap-3">
        <span className="dm-card-type">
          <TypeIcon kind={p.icon} size={14} />
          {p.type.toUpperCase()}
          {p.status && (
            <>
              <span className="dm-sep" aria-hidden="true">
                ·
              </span>
              <span className="tracking-normal">{p.status}</span>
            </>
          )}
        </span>
        <span className="flex items-center gap-2.5">
          {p.bars}
          {p.code && <Code>{p.code}</Code>}
        </span>
      </span>
      <div className="flex flex-col gap-0.5">
        <strong className="dm-text-title">{p.title}</strong>
        {p.line && <span className="dm-text-small text-ink-3">{p.line}</span>}
      </div>
      {p.children}
      {(p.who || p.actions) && (
        <div className="dm-text-caption flex items-center justify-between gap-2 border-t border-line-soft pt-3 text-muted">
          <span className="flex items-center gap-1.5">{p.who}</span>
          <span className="flex items-center gap-2">{p.actions}</span>
        </div>
      )}
    </Panel>
  );
}

/** Code of a record, small and in mono: names go before codes, and codes only in the detail. */
export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('dm-code', className)}>{children}</span>;
}
