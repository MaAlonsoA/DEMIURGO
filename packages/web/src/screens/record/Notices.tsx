// What the record page has to say about the version on screen (DESIGN.md §3.6, INV-REC-12…14): the
// warnings its save returned, "Approved. What needs you next" right after the person approved it
// here, "ready to build", and the version notices (an earlier draft, replaced, discarded, a newer
// draft). They stack: several can hold at once, and none hides another (INVENTORY INV-REC, UX
// problem: one banner at a time).

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { readinessQuery } from '../../api/queries.ts';
import type { Readiness, RecordDetail, RecordVersion } from '../../api/types.ts';
import { buttonClass } from '../../components/Button.tsx';
import { ArrowRightIcon } from '../../components/icons.tsx';
import { Notice } from '../../components/Notice.tsx';
import { useMessages } from '../../i18n/define.ts';
import type { NeedsItem } from '../overview/needs.ts';
import { isEarlierDraft, newerDraft } from './logic.ts';
import { NOTICES } from './words.i18n.ts';

function NextLink({ projectId, next, className }: { projectId: string; next: NeedsItem; className: string }) {
  const t = useMessages(NOTICES);
  return (
    <Link
      to={next.target.to}
      params={{ projectId, ...next.target.params } as never}
      search={('search' in next.target ? next.target.search : undefined) as never}
      className={className}
    >
      <span className="truncate">{t.next(next.title)}</span>
      <ArrowRightIcon size={14} className="shrink-0" />
    </Link>
  );
}

const SEE = 'inline-flex items-center gap-1 font-medium text-accent-text hover:underline';

function See({ projectId, code, n, children }: { projectId: string; code: string; n: number; children: ReactNode }) {
  return (
    <Link to="/p/$projectId/records/$code" params={{ projectId, code }} search={{ v: n }} className={SEE}>
      {children} <ArrowRightIcon size={12} />
    </Link>
  );
}

export function RecordNotices({
  projectId,
  record,
  version,
  readiness,
  next,
  justApproved,
  warnings,
}: {
  projectId: string;
  record: RecordDetail;
  version: RecordVersion;
  readiness: Readiness | null;
  next: NeedsItem | undefined;
  /** The person approved this version on this page a moment ago. */
  justApproved: boolean;
  /** What the save of this version said (record_version.create's warnings). */
  warnings: string[];
}) {
  const t = useMessages(NOTICES);
  const earlier = isEarlierDraft(record, version);
  const earlierReason = useQuery({ ...readinessQuery(projectId, version.id), enabled: earlier }).data?.reasons.find((r) =>
    r.startsWith(`Version ${version.n} is a draft earlier`),
  );
  const newer = newerDraft(record, version);
  const ready = !!readiness?.ready && version.current;
  const items: ReactNode[] = [];

  if (warnings.length > 0)
    items.push(
      <Notice key="warnings" tone="warning" title={t.savedWithWarnings}>
        <ul className="list-disc pl-5">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </Notice>,
    );
  if (justApproved && next && !ready)
    items.push(
      <Notice
        key="next"
        tone="success"
        title={t.approvedTitle}
        action={<NextLink projectId={projectId} next={next} className={buttonClass({ size: 'sm' })} />}
      >
        {t.approvedBody}
      </Notice>,
    );
  if (ready)
    items.push(
      <div
        key="ready"
        data-ready-banner
        className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-success-edge bg-success-soft px-4 py-3"
      >
        <div className="flex min-w-0 flex-1 basis-64 flex-col">
          <p className="text-base font-semibold text-fg">{t.readyToBuildTitle(version.title)}</p>
          <p className="text-sm text-fg-2">{t.nothingBuiltYet}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/p/$projectId" params={{ projectId }} className={buttonClass()}>
            {t.backToProduct}
          </Link>
          {next ? <NextLink projectId={projectId} next={next} className={buttonClass({ variant: 'primary' })} /> : null}
        </div>
      </div>,
    );
  if (earlier)
    items.push(
      <Notice key="earlier" tone="neutral">
        {earlierReason ?? t.earlierDefault(record.current as number)}
      </Notice>,
    );
  if (version.state === 'superseded' && record.current !== null)
    items.push(
      <Notice key="replaced" tone="neutral">
        {t.replaced(record.current)}{' '}
        <See projectId={projectId} code={record.code} n={record.current}>
          {t.seeV(record.current)}
        </See>
      </Notice>,
    );
  if (version.state === 'discarded')
    items.push(
      <Notice key="discarded" tone="neutral">
        {t.discarded}
      </Notice>,
    );
  if (newer)
    items.push(
      <Notice key="newer" tone="accent">
        {t.newerDraft(newer.n)}{' '}
        <See projectId={projectId} code={record.code} n={newer.n}>
          {t.seeV(newer.n)}
        </See>
      </Notice>,
    );

  if (items.length === 0) return null;
  return (
    <div data-record-notices className="flex flex-col gap-3">
      {items}
    </div>
  );
}
