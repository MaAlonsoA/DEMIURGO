// Models & providers (DESIGN.md §3.9; FDR-AGE-002; INV-MODELS-01…20): what each provider offers
// right now, which engine runs each part of DEMIURGO — everywhere and, inside a project, here —
// and what the engines have spent. Only discovered models can be chosen and nothing switches on
// its own. It also lives outside any project (/models, in the workspace frame), so a first
// project that can't start for lack of an engine has somewhere to go.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { agentsQuery, providersQuery, refreshProviders } from '../../api/models.ts';
import { projectsQuery } from '../../api/queries.ts';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { CpuIcon, RefreshIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, Section, usePageTitle } from '../../components/Page.tsx';
import { Bone, RowsSkeleton, Skeleton } from '../../components/Spinner.tsx';
import { useProjectId } from '../../lib/hooks.ts';
import { WorkspaceFrame } from '../../shell/WorkspaceFrame.tsx';
import { AgentRow } from './Agents.tsx';
import { agentOrder } from './engines.ts';
import { ProviderCard } from './Providers.tsx';
import { SpendSection, StatsSection } from './Spend.tsx';

/** Inside a project: everywhere and this project's overrides. */
export function ModelsScreen() {
  const projectId = useProjectId();
  const project = (useQuery(projectsQuery).data ?? []).find((p) => p.id === projectId);
  usePageTitle(['Models & providers', project?.name]);
  return <ModelsAndProviders projectId={projectId} />;
}

/** Outside any project: only the choice for everywhere. */
export function WorkspaceModelsScreen() {
  usePageTitle(['Models & providers']);
  return (
    <WorkspaceFrame current="models">
      <ModelsAndProviders />
    </WorkspaceFrame>
  );
}

function ModelsAndProviders({ projectId }: { projectId?: string }) {
  const client = useQueryClient();
  const providers = useQuery(providersQuery);
  const agents = useQuery(agentsQuery(projectId));
  const refresh = useMutation({
    mutationFn: refreshProviders,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['models'] });
      announce('Providers checked again.');
    },
  });
  const catalogs = providers.data?.catalogs ?? [];
  const agentList = agents.data?.agents;

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <CpuIcon size={14} className="text-fg-3" />
            Settings
          </span>
        }
        title="Models & providers"
        meta={
          <span className="max-w-3xl">
            Which engine runs each part of DEMIURGO. You choose from what each provider offers right now; DEMIURGO never switches
            on its own.
            {projectId ? null : ' This is the choice for every project.'}
          </span>
        }
        actions={
          <Button
            data-refresh-providers
            icon={<RefreshIcon size={14} />}
            pending={refresh.isPending}
            pendingLabel="Looking…"
            onClick={() => refresh.mutate()}
          >
            Refresh
          </Button>
        }
      >
        {refresh.error ? <ErrorNotice error={refresh.error} /> : null}
      </PageHeader>
      <PageBody>
        <div className="flex flex-col gap-10">
          <Section title="Providers" id="providers" note="Discovered without spending quota">
            {providers.isPending ? (
              <Skeleton label="Loading the providers" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Bone className="h-44 rounded-lg" />
                <Bone className="h-44 rounded-lg" />
                <Bone className="h-44 rounded-lg" />
              </Skeleton>
            ) : providers.error && !providers.data ? (
              <ErrorNotice error={providers.error} onRetry={() => void providers.refetch()} />
            ) : catalogs.length === 0 ? (
              <EmptyState title="No providers found" headingLevel={3}>
                DEMIURGO looks for Claude, Codex and OpenCode on this machine. Install one, then Refresh.
              </EmptyState>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {catalogs.map((c) => (
                  <ProviderCard key={c.provider} catalog={c} />
                ))}
              </div>
            )}
          </Section>

          <Section title="Who does what" id="agents" note="A change applies to the next run, never to one already asked for.">
            {agents.isPending || providers.isPending ? (
              <RowsSkeleton label="Loading the parts of DEMIURGO" rows={5} />
            ) : agents.error && !agents.data ? (
              <ErrorNotice error={agents.error} onRetry={() => void agents.refetch()} />
            ) : !agentList || agentList.length === 0 ? (
              <EmptyState title="No parts of DEMIURGO found" headingLevel={3}>
                The agents come with DEMIURGO. If none shows, the server could not read its catalog.
              </EmptyState>
            ) : (
              <ul aria-label="Parts of DEMIURGO" className="flex flex-col">
                {agentList
                  .toSorted((a, b) => agentOrder(a.id, b.id))
                  .map((a) => (
                    <AgentRow
                      key={a.id}
                      agent={a}
                      catalogs={catalogs}
                      skills={agents.data?.skills ?? []}
                      {...(projectId ? { projectId } : {})}
                    />
                  ))}
              </ul>
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
