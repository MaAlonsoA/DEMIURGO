// Models & providers (DESIGN.md §3.9; FDR-AGE-002; INV-MODELS-01…20): what each provider offers
// right now, which engine runs each group of tasks (and the tasks that are exceptions), the same
// for every project, and what the engines have spent. Only discovered models can be chosen and nothing switches on
// its own. It also lives outside any project (/models, in the workspace frame), so a first
// project that can't start for lack of an engine has somewhere to go.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { agentsQuery, providersQuery, refreshProviders } from '../../api/models.ts';
import { projectsQuery } from '../../api/queries.ts';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ChevronRightIcon, CpuIcon, RefreshIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, Section, usePageTitle } from '../../components/Page.tsx';
import { Bone, RowsSkeleton, Skeleton } from '../../components/Spinner.tsx';
import { useMessages } from '../../i18n/define.ts';
import { useProjectId } from '../../lib/hooks.ts';
import { WorkspaceFrame } from '../../shell/WorkspaceFrame.tsx';
import { GroupCard, TaskRow } from './Groups.tsx';
import { agentOrder } from './engines.ts';
import { ProviderCard } from './Providers.tsx';
import { SpendSection, StatsSection } from './Spend.tsx';
import { MODELS } from './words.i18n.ts';

/** Inside a project: the same choice as outside, which applies to every project. */
export function ModelsScreen() {
  const t = useMessages(MODELS);
  const projectId = useProjectId();
  const project = (useQuery(projectsQuery).data ?? []).find((p) => p.id === projectId);
  usePageTitle([t.title, project?.name]);
  return <ModelsAndProviders />;
}

/** Outside any project: a first project needs an engine before it exists. */
export function WorkspaceModelsScreen() {
  const t = useMessages(MODELS);
  usePageTitle([t.title]);
  return (
    <WorkspaceFrame current="models">
      <ModelsAndProviders />
    </WorkspaceFrame>
  );
}

function ModelsAndProviders() {
  const t = useMessages(MODELS);
  const client = useQueryClient();
  const providers = useQuery(providersQuery);
  const agents = useQuery(agentsQuery);
  const refresh = useMutation({
    mutationFn: refreshProviders,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['models'] });
      announce(t.providersChecked);
    },
  });
  const catalogs = providers.data?.catalogs ?? [];
  const agentList = agents.data?.agents;
  const groups = agents.data?.groups ?? [];
  const skills = agents.data?.skills ?? [];
  const sorted = (agentList ?? []).toSorted((a, b) => agentOrder(a.id, b.id));
  const ungrouped = sorted.filter((a) => !a.group || !groups.some((g) => g.id === a.group));

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <CpuIcon size={14} className="text-fg-3" />
            {t.eyebrow}
          </span>
        }
        title={t.title}
        meta={<span className="max-w-3xl">{t.meta}</span>}
        actions={
          <Button
            data-refresh-providers
            icon={<RefreshIcon size={14} />}
            pending={refresh.isPending}
            pendingLabel={t.looking}
            onClick={() => refresh.mutate()}
          >
            {t.refresh}
          </Button>
        }
      >
        {refresh.error ? <ErrorNotice error={refresh.error} /> : null}
      </PageHeader>
      <PageBody>
        <div className="flex flex-col gap-10">
          <Section title={t.providersTitle} id="providers" note={t.providersNote}>
            {providers.isPending ? (
              <Skeleton label={t.loadingProviders} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Bone className="h-44 rounded-lg" />
                <Bone className="h-44 rounded-lg" />
                <Bone className="h-44 rounded-lg" />
              </Skeleton>
            ) : providers.error && !providers.data ? (
              <ErrorNotice error={providers.error} onRetry={() => void providers.refetch()} />
            ) : catalogs.length === 0 ? (
              <EmptyState title={t.noProvidersTitle} headingLevel={3}>
                {t.noProvidersBody}
              </EmptyState>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {catalogs.map((c) => (
                  <ProviderCard key={c.provider} catalog={c} />
                ))}
              </div>
            )}
          </Section>

          <Section title={t.agentsTitle} id="agents" note={t.agentsNote}>
            {agents.isPending || providers.isPending ? (
              <RowsSkeleton label={t.loadingParts} rows={5} />
            ) : agents.error && !agents.data ? (
              <ErrorNotice error={agents.error} onRetry={() => void agents.refetch()} />
            ) : !agentList || agentList.length === 0 ? (
              <EmptyState title={t.noPartsTitle} headingLevel={3}>
                {t.noPartsBody}
              </EmptyState>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="grid gap-4 xl:grid-cols-2">
                  {groups.map((g) => (
                    <GroupCard
                      key={g.id}
                      group={g}
                      agents={sorted.filter((a) => a.group === g.id)}
                      catalogs={catalogs}
                      skills={skills}
                    />
                  ))}
                </div>
                {ungrouped.length > 0 ? (
                  <details data-ungrouped className="group rounded-lg border border-edge-subtle p-4">
                    <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1 text-sm font-medium text-fg-2 hover:text-fg [&::-webkit-details-marker]:hidden">
                      <ChevronRightIcon size={12} className="transition-transform group-open:rotate-90" />
                      {t.tasksOutsideGroup(ungrouped.length)}
                    </summary>
                    <ul aria-label={t.tasksOutsideGroupLabel} className="mt-2 flex flex-col">
                      {ungrouped.map((a) => (
                        <TaskRow
                          key={a.id}
                          agent={a}
                          catalogs={catalogs}
                          skills={skills}
                          groupEngine={null}
                          groupFallback={null}
                        />
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            )}
          </Section>

          {providers.data ? (
            <>
              <SpendSection consumption={providers.data.consumption} catalogs={catalogs} agents={agentList} />
              <StatsSection stats={providers.data.stats} catalogs={catalogs} agents={agentList} />
            </>
          ) : null}
        </div>
      </PageBody>
    </>
  );
}
