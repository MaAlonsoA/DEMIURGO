// The frame every record page shares (records navigator + page) and its two columns.

import type { ReactNode } from 'react';
import { useMessages } from '../../i18n/define.ts';
import { cn } from '../../lib/cn.ts';
import { RecordsNavigator } from '../blueprint/Navigator.tsx';
import { RECORD } from './words.i18n.ts';

/** The navigator beside the page; the page is a size container, so its columns follow its own width. */
export function Frame({ projectId, code, children }: { projectId: string; code: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col lg:flex-row">
      <RecordsNavigator projectId={projectId} code={code} />
      <div className="@container min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Main content and its side column: stacked, then side by side from a 56rem wide content area. */
export function Columns({ main, aside, asideFirst = false }: { main: ReactNode; aside: ReactNode; asideFirst?: boolean }) {
  const t = useMessages(RECORD);
  return (
    <div className="flex flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8 @4xl:flex-row @4xl:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-8">{main}</div>
      <aside
        aria-label={t.aboutRecord}
        className={cn(
          'flex w-full shrink-0 flex-col gap-8 @4xl:sticky @4xl:top-3 @4xl:w-80 @6xl:w-96',
          // A delivery page's properties come right under the header on a phone, not far down.
          asideFirst && 'order-first @4xl:order-last @4xl:w-72 @6xl:w-80',
        )}
      >
        {aside}
      </aside>
    </div>
  );
}
