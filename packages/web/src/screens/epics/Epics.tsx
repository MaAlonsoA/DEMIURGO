// The epics of the product (EPC), each with its features under it. Work on an epic happens on its
// page, by asking DEMIURGO about it; this page is where to find them.

import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { inboxQuery, projectsQuery, stateQuery } from '../../api/queries.ts';
import type { ProductRow } from '../../api/types.ts';
import { buttonClass } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { JourneyIcon } from '../../components/icons.tsx';
import { Certainty } from '../../components/status.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, Section, usePageTitle } from '../../components/Page.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useProjectId } from '../../lib/hooks.ts';
import { RecordRow, RowList, UNCHANGED } from '../overview/Cards.tsx';
import { waitingFor } from '../record/logic.ts';
import { epicGroups } from './logic.ts';
import { EPICS } from './words.i18n.ts';

export function EpicsScreen() {
  const t = useMessages(EPICS);
  const projectId = useProjectId();
  const navigate = useNavigate();
  const state = useQuery(stateQuery(projectId));
  const inbox = useQuery(inboxQuery(projectId));
  const project = useQuery(projectsQuery).data?.find((p) => p.id === projectId);
  usePageTitle([t.title, project?.name]);

  const s = state.data;
  const { groups } = epicGroups(s ? [...s.designs, ...s.decisions] : []);
  const featureCount = groups.reduce((n, g) => n + g.features.length, 0);
  const row = (r: ProductRow) => (
    <RecordRow
      key={r.code}
      projectId={projectId}
      row={r}
      waiting={waitingFor(r.code, inbox.data, r.origin_exploration)}
      change={UNCHANGED}
      onPreview={() => void navigate({ to: '/p/$projectId/records/$code', params: { projectId, code: r.code } })}
    />
  );

  return (
    <>
      <PageHeader title={t.title} meta={s && groups.length > 0 ? <span className="tabular-nums">{t.meta(groups.length, featureCount)}</span> : null} />
      <PageBody width="wide" className="flex flex-col gap-8">
        {state.isPending ? (
          <Skeleton label={t.loading}>
            <Bone className="h-24 w-full" />
            <Bone className="h-24 w-full" />
          </Skeleton>
        ) : !s ? (
          <ErrorNotice error={state.error} onRetry={() => void state.refetch()} />
        ) : groups.length === 0 ? (
          <EmptyState
            size="spacious"
            icon={<JourneyIcon size={28} />}
            title={t.noneYet}
            action={
              <Link to="/p/$projectId" params={{ projectId }} className={buttonClass({ variant: 'primary' })}>
                {t.goToProduct}
              </Link>
            }
          >
            {t.noneHint}
          </EmptyState>
        ) : (
          groups.map((g) => (
            <Section
              key={g.epic.code}
              id={`epic-${g.epic.code}`}
              title={
                <>
                  <span className="font-mono text-sm text-fg-3">{g.epic.code}</span> {g.epic.title}
                </>
              }
              note={g.epic.summary ?? undefined}
              actions={
                <span className="flex items-center gap-3">
                <Certainty status={g.epic.epistemic_status} />
                <Link
                  to="/p/$projectId/records/$code"
                  params={{ projectId, code: g.epic.code }}
                  className={buttonClass({ size: 'sm' })}
                >
                  {t.open}
                </Link>
                </span>
              }
            >
              {g.features.length === 0 ? (
                <p className="text-sm text-fg-2">{t.noFeatures}</p>
              ) : (
                <RowList label={`${t.features}: ${g.epic.title}`}>{g.features.map(row)}</RowList>
              )}
            </Section>
          ))
        )}
      </PageBody>
    </>
  );
}
