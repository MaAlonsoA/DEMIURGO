// Routes of the app (spec §3). Every route except /sign-in needs a session: without one, it goes
// to /sign-in keeping where the person was going (AC-INT-001-02).

import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, notFound, redirect } from '@tanstack/react-router';
import { projectsQuery, sessionQuery } from './api/queries.ts';
import { ActivityScreen } from './screens/activity/Activity.tsx';
import { BatchScreen } from './screens/batch/Batch.tsx';
import { KnowledgeScreen } from './screens/knowledge/Knowledge.tsx';
import { NeedsYouScreen } from './screens/needs-you/NeedsYou.tsx';
import { AgentKeysScreen } from './screens/agent-keys/AgentKeys.tsx';
import { NewRecordScreen } from './screens/new-record/NewRecord.tsx';
import { NewVersionScreen } from './screens/new-version/NewVersion.tsx';
import { NotFound } from './screens/not-found/NotFound.tsx';
import { DayDoneScreen } from './screens/onboarding/DayDone.tsx';
import { landingOf } from './screens/onboarding/landing.ts';
import { NewProjectScreen } from './screens/onboarding/NewProject.tsx';
import { QuestionsScreen } from './screens/onboarding/Questions.tsx';
import { StartScreen } from './screens/onboarding/Start.tsx';
import { OriginsScreen } from './screens/origins/Origins.tsx';
import { OverviewScreen } from './screens/overview/Overview.tsx';
import { ProjectsScreen } from './screens/projects/Projects.tsx';
import { RecordScreen } from './screens/record/Record.tsx';
import { RunScreen } from './screens/run/Run.tsx';
import { AppRoot } from './screens/shell/AppRoot.tsx';
import { ProjectShell } from './screens/shell/ProjectShell.tsx';
import { SignInScreen } from './screens/sign-in/SignIn.tsx';
import { JourneysScreen } from './screens/journeys/Journeys.tsx';
import { MapScreen } from './screens/map/Map.tsx';
import { ModelsScreen, WorkspaceModelsScreen } from './screens/models/ModelsAndProviders.tsx';
import { SourcesScreen } from './screens/sources/Sources.tsx';
import { ThreadScreen } from './screens/thread/Thread.tsx';
import { ThreadsScreen } from './screens/threads/Threads.tsx';

export type RouterContext = { queryClient: QueryClient };

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: AppRoot,
  notFoundComponent: () => <NotFound />,
});

const text = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in',
  validateSearch: (s: Record<string, unknown>): { next?: string } => {
    const next = text(s.next);
    return next ? { next } : {};
  },
  component: SignInScreen,
});

const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (!session) throw redirect({ to: '/sign-in', search: { next: location.href } });
  },
});

// With a single project, the person goes straight into it (FDR-INT-001, behavior 1); with none, to
// "What do you want to build?" (Day 1).
const indexRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/',
  beforeLoad: async ({ context }) => {
    const landing = landingOf(await context.queryClient.fetchQuery(projectsQuery));
    if (landing.to === '/p/$projectId') throw redirect({ to: landing.to, params: { projectId: landing.projectId } });
    throw redirect({ to: landing.to });
  },
});

const projectsRoute = createRoute({ getParentRoute: () => authedRoute, path: '/projects', component: ProjectsScreen });
const newProjectRoute = createRoute({ getParentRoute: () => authedRoute, path: '/new', component: NewProjectScreen });
// Models & providers outside any project: the first project needs an engine before it exists.
const workspaceModelsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/models',
  component: WorkspaceModelsScreen,
});

const projectRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/p/$projectId',
  component: ProjectShell,
  loader: async ({ context, params }) => {
    const projects = await context.queryClient.ensureQueryData(projectsQuery);
    if (!projects.some((p) => p.id === params.projectId)) throw notFound();
  },
});

const overviewRoute = createRoute({ getParentRoute: () => projectRoute, path: '/', component: OverviewScreen });
const originsRoute = createRoute({ getParentRoute: () => projectRoute, path: '/origins', component: OriginsScreen });
const mapRoute = createRoute({ getParentRoute: () => projectRoute, path: '/map', component: MapScreen });
const journeysRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/journeys',
  validateSearch: (s: Record<string, unknown>): { j?: string } => {
    const j = text(s.j);
    return j ? { j } : {};
  },
  component: JourneysScreen,
});
const recordRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/records/$code',
  validateSearch: (s: Record<string, unknown>): { v?: number } => {
    const v = Number(s.v);
    return Number.isInteger(v) && v > 0 ? { v } : {};
  },
  component: RecordScreen,
});
const newRecordRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/records/new',
  validateSearch: (s: Record<string, unknown>): { type?: string } => {
    const type = text(s.type);
    return type ? { type } : {};
  },
  component: NewRecordScreen,
});
const newVersionRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/records/$code/new-version',
  component: NewVersionScreen,
});
const threadsRoute = createRoute({ getParentRoute: () => projectRoute, path: '/threads', component: ThreadsScreen });
const threadRoute = createRoute({ getParentRoute: () => projectRoute, path: '/threads/$explorationId', component: ThreadScreen });
const needsYouRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/needs-you',
  validateSearch: (s: Record<string, unknown>): { 'catch-up'?: number } =>
    s['catch-up'] === 1 || s['catch-up'] === '1' ? { 'catch-up': 1 } : {},
  component: NeedsYouScreen,
});
const batchRoute = createRoute({ getParentRoute: () => projectRoute, path: '/batches/$batchId', component: BatchScreen });
const activityRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/activity',
  validateSearch: (s: Record<string, unknown>): { state?: string } => {
    const state = text(s.state);
    return state ? { state } : {};
  },
  component: ActivityScreen,
});
const runRoute = createRoute({ getParentRoute: () => projectRoute, path: '/runs/$runId', component: RunScreen });
const knowledgeRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/knowledge',
  validateSearch: (s: Record<string, unknown>): { tab?: string } => {
    const tab = text(s.tab);
    return tab ? { tab } : {};
  },
  component: KnowledgeScreen,
});
const sourcesRoute = createRoute({ getParentRoute: () => projectRoute, path: '/sources', component: SourcesScreen });
const modelsRoute = createRoute({ getParentRoute: () => projectRoute, path: '/models', component: ModelsScreen });
const agentKeysRoute = createRoute({ getParentRoute: () => projectRoute, path: '/agent-keys', component: AgentKeysScreen });
const startRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/start/$explorationId',
  component: StartScreen,
});
const startQuestionsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/start/$explorationId/questions',
  component: QuestionsScreen,
});
const startDoneRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/start/$explorationId/done',
  component: DayDoneScreen,
});

const routeTree = rootRoute.addChildren([
  signInRoute,
  authedRoute.addChildren([
    indexRoute,
    projectsRoute,
    newProjectRoute,
    workspaceModelsRoute,
    projectRoute.addChildren([
      overviewRoute,
      originsRoute,
      mapRoute,
      journeysRoute,
      recordRoute,
      newRecordRoute,
      newVersionRoute,
      threadsRoute,
      threadRoute,
      needsYouRoute,
      batchRoute,
      activityRoute,
      runRoute,
      knowledgeRoute,
      sourcesRoute,
      modelsRoute,
      agentKeysRoute,
      startRoute,
      startQuestionsRoute,
      startDoneRoute,
    ]),
  ]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
