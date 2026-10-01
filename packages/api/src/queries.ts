// Query routes (read-only). Each one declares its query from the capability matrix.

import {
  COVERED_QUESTION_STATES,
  DomainError,
  LOCALES,
  type Locale,
  type QueryName,
  STAGES,
  TRANSLATION_SUBJECTS,
  type TranslationSubject,
  graphFingerprint,
  parseTraceParent,
} from '@demiurgo/domain';
import { sql } from 'kysely';
import {
  type Services,
  inbox,
  searchKnowledge,
  loadGraph,
  compareRebuild,
  graphUpToDate,
  explorationDetail,
  batchDetail,
  recordDetail,
  taskDraftView,
  productState,
  versionReadiness,
  explorationsList,
  runsList,
  typicalByAction,
  knowledgeGraph,
  ideaAssessments,
  taxonomiesList,
  changesSince,
  productJourneys,
  productMap,
  projectUsage,
  readingTranslation,
  projectGlossary,
  productDefinition,
  buildQueue,
  executionFacts,
  factsToCsv,
  observabilitySummary,
  judgmentCalibration,
  harnessScorecards,
  scorecardsByVersion,
  attentionByStage,
  worthIt,
  harnessFindingRows,
  harnessEscapes,
  harnessChecks,
  harnessContainment,
  escapesToCsv,
  findingsToCsv,
  queueDecisionRows,
  queueDecisionsToCsv,
  testHistory,
  buildTimelineOf,
  projectDeliveryMetrics,
  autoStatus,
  hotspotsOf,
  bounceReasonsOf,
  isHotspot,
  composeBrief,
  coherenceStatus,
  githubConfig,
  loadProjectMap,
  issuesList,
  issueDetail,
  taskForensicsOf,
  forensicsOverview,
} from '@demiurgo/core';
import type { Credential } from './credentials.ts';

export type QueryInput = {
  services: Services;
  params: Record<string, string>;
  query: Record<string, string>;
  credential: Credential;
};

export type QueryRoute = {
  path: string;
  queryName: QueryName;
  respond(e: QueryInput): Promise<unknown>;
  /** The answer is a string sent as a file download instead of JSON. */
  download?: { contentType: string; filename: string };
};

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(v: string | undefined, what: string): string {
  if (!v || !RE_UUID.test(v)) throw new DomainError('not_found', `The ${what} does not exist.`);
  return v;
}

/** The optional filters of the harness routes: ?rules=&piece=&from=&to=&engine_cohort= (dates as ISO text; engine_cohort `current` by default, `all` to mix). */
function harnessFilters(query: Record<string, string>) {
  const date = (v: string | undefined) => (v && !Number.isNaN(Date.parse(v)) ? v : undefined);
  return { rules: query.rules || undefined, piece: query.piece || undefined, engine_cohort: query.engine_cohort || undefined, from: date(query.from), to: date(query.to) };
}

export const QUERIES: QueryRoute[] = [
  {
    path: '/api/projects',
    queryName: 'query.projects',
    async respond({ services }) {
      return services.db.selectFrom('projects').select(['id', 'name', 'state', 'created_at']).orderBy('created_at').execute();
    },
  },
  {
    path: '/api/projects/:projectId/events',
    queryName: 'query.events',
    async respond({ services, params, query }) {
      const projectId = uuid(params.projectId, 'project');
      const from = /^\d+$/.test(query.from ?? '') ? String(query.from) : '0';
      // ?entity= keeps only the events of one entity (a run, a batch…) and those it caused.
      let q = services.db.selectFrom('events').selectAll().where('project_id', '=', projectId).where('id', '>', from);
      if (query.entity) {
        const entity = uuid(query.entity, 'entity');
        q = q.where((eb) => eb.or([eb('entity_id', '=', entity), eb(sql<string>`cause->>'run'`, '=', entity)]));
      }
      return q.orderBy('id').limit(1000).execute();
    },
  },
  {
    // Run requests the server queued (HTTP 202) because knowledge is updating: no run exists yet.
    path: '/api/projects/:projectId/runs-queued',
    queryName: 'query.runs',
    async respond({ services, params }) {
      const projectId = uuid(params.projectId, 'project');
      const rows = await services.engine.deferredRunsOf(projectId);
      return rows.flatMap((r) => {
        const m = /^run:([a-z_]+):([^:]+):/.exec(r.key);
        return m ? [{ key: r.key, action: m[1], scope_id: m[2], created_at: new Date(r.createdAt).toISOString() }] : [];
      });
    },
  },
  {
    path: '/api/projects/:projectId/runs/:runId',
    queryName: 'query.runs',
    async respond({ services, params }) {
      const projectId = uuid(params.projectId, 'project');
      const run = await services.db
        .selectFrom('ai_runs')
        .selectAll()
        .where('project_id', '=', projectId)
        .where('id', '=', uuid(params.runId, 'run'))
        .executeTakeFirst();
      if (!run) throw new DomainError('not_found', 'The run does not exist.');
      const pack = run.context_pack_id
        ? await services.db
            .selectFrom('context_packs')
            .select(['id', 'role', 'builder', 'budget', 'graph_version', 'dependencies', 'content', 'hash'])
            .where('id', '=', run.context_pack_id)
            .executeTakeFirst()
        : null;
      const trace = await services.db
        .selectFrom('trace_contexts')
        .select('trace_parent')
        .where('project_id', '=', projectId)
        .where('entity_type', '=', 'ai_run')
        .where('entity_id', '=', run.id)
        .executeTakeFirst();
      return {
        ...run,
        context_pack: pack ?? null,
        typical: (await typicalByAction(services.db, [run.action])).get(run.action) ?? null,
        trace_id: trace ? (parseTraceParent(trace.trace_parent)?.traceId ?? null) : null,
      };
    },
  },
];

export function registerQueries(additions: QueryRoute[]): void {
  QUERIES.push(...additions);
}

registerQueries([
  {
    // The project's glossary: each word and the English term records and translations use for it.
    path: '/api/projects/:projectId/glossary',
    queryName: 'query.glossary',
    respond: ({ services, params }) => projectGlossary(services.db, uuid(params.projectId, 'project')),
  },
  {
    // A record in the person's language, for reading only: `?lang=es`. The source is loaded by the server.
    path: '/api/projects/:projectId/translations/:subject/:id',
    queryName: 'query.translations',
    respond: ({ services, params, query }) => {
      const subject = params.subject as TranslationSubject;
      if (!TRANSLATION_SUBJECTS.includes(subject)) throw new DomainError('not_found', 'There is nothing to translate there.');
      const lang = query.lang as Locale;
      if (!LOCALES.includes(lang)) throw new DomainError('validation', `Unknown language: ${query.lang ?? '(none)'}.`);
      return readingTranslation(services, {
        projectId: uuid(params.projectId, 'project'),
        subject,
        id: uuid(params.id, subject.replace('_', ' ')),
        lang,
      });
    },
  },
  {
    path: '/api/projects/:projectId/state',
    queryName: 'query.state',
    respond: ({ services, params }) => productState(services.db, uuid(params.projectId, 'project')),
  },
  {
    // The product's map and journeys (FDR-INT-002): read like the records they come from.
    path: '/api/projects/:projectId/map',
    queryName: 'query.records',
    respond: ({ services, params }) => productMap(services.db, uuid(params.projectId, 'project')),
  },
  {
    path: '/api/projects/:projectId/journeys',
    queryName: 'query.records',
    respond: ({ services, params }) => productJourneys(services.db, uuid(params.projectId, 'project')),
  },
  {
    path: '/api/projects/:projectId/inbox',
    queryName: 'query.inbox',
    respond: ({ services, params }) => inbox(services.db, uuid(params.projectId, 'project')),
  },
  {
    path: '/api/projects/:projectId/explorations',
    queryName: 'query.explorations',
    respond: ({ services, params }) => explorationsList(services.db, uuid(params.projectId, 'project')),
  },
  {
    path: '/api/projects/:projectId/explorations/:explorationId',
    queryName: 'query.explorations',
    respond: ({ services, params }) =>
      explorationDetail(services.db, uuid(params.projectId, 'project'), uuid(params.explorationId, 'exploration')),
  },
  {
    path: '/api/projects/:projectId/sources',
    queryName: 'query.explorations',
    respond: ({ services, params }) =>
      services.db
        .selectFrom('sources')
        .select(['id', 'name', 'content_hash', 'registered_by', 'created_at'])
        .where('project_id', '=', uuid(params.projectId, 'project'))
        .orderBy('created_at')
        .execute(),
  },
  {
    path: '/api/projects/:projectId/records/:code',
    queryName: 'query.records',
    respond: ({ services, params }) => recordDetail(services.db, uuid(params.projectId, 'project'), params.code ?? ''),
  },
  {
    // A task proposed by the task planner (pending, accepted or rejected), read as the task page reads a record.
    path: '/api/projects/:projectId/task-drafts/:proposalId',
    queryName: 'query.records',
    respond: ({ services, params }) =>
      taskDraftView(services.db, uuid(params.projectId, 'project'), uuid(params.proposalId, 'proposal')),
  },
  {
    // The product definition: its versions with the question each section comes from, and the proposed one.
    path: '/api/projects/:projectId/definition',
    queryName: 'query.records',
    respond: ({ services, params }) => productDefinition(services.db, uuid(params.projectId, 'project')),
  },
  {
    // The Build page (FDR-BUI-002): ready tasks in build order, Waiting with its reasons, open requests.
    path: '/api/projects/:projectId/build',
    queryName: 'query.records',
    respond: async ({ services, params, query }) => {
      const projectId = uuid(params.projectId, 'project');
      const queue = await buildQueue(services.db, projectId);
      // The lanes and the path of each task (?hours= widens the window, default 8 h): titles come from the queue.
      const timeline = await buildTimelineOf(services.db, projectId, /^\d+$/.test(query.hours ?? '') ? Number(query.hours) : undefined).catch(() => null);
      const known = new Map([...queue.ready, ...queue.waiting, ...queue.held, ...queue.stale, ...queue.built].map((t) => [t.code, t]));
      return {
        ...queue,
        timeline: timeline
          ? {
              ...timeline,
              requests: timeline.requests.map((r) => ({
                ...r,
                task_title: known.get(r.task_code)?.title,
                feature: known.get(r.task_code)?.feature ?? null,
              })),
            }
          : undefined,
        auto: await autoStatus(services.db, projectId, queue),
        delivery: await projectDeliveryMetrics(services.db, projectId),
        // The files most merged tasks changed: where parallel builds collide (top 3 that pass the threshold).
        hotspots: (await hotspotsOf(services.db, projectId)).filter((h) => isHotspot(h)).slice(0, 3),
        // Why pull requests bounce: Jev's category of each reviewer comment of the last 30 days.
        bounces: await bounceReasonsOf(services.db, projectId).catch(() => []),
      };
    },
  },
  {
    // Flaky and slow tests, from every CI test result kept per test and commit.
    path: '/api/projects/:projectId/observability/tests',
    queryName: 'query.records',
    respond: async ({ services, params }) => testHistory(services.db, uuid(params.projectId, 'project')),
  },
  {
    // Integrated observability: one fact per build attempt joined with what DEMIURGO knows, and the summary over them.
    path: '/api/projects/:projectId/observability',
    queryName: 'query.records',
    respond: async ({ services, params }) => {
      const { facts, agent_runs } = await executionFacts(services.db, uuid(params.projectId, 'project'));
      return { facts, summary: observabilitySummary(facts, agent_runs) };
    },
  },
  {
    // Did Jev's size and file predictions match what happened? Derived on read (core queries/calibration.ts).
    path: '/api/projects/:projectId/observability/calibration',
    queryName: 'query.records',
    respond: ({ services, params }) => judgmentCalibration(services.db, uuid(params.projectId, 'project')),
  },
  {
    // Harness health: a scorecard and a verdict per piece, with the cases behind them (core queries/harness-health.ts).
    path: '/api/projects/:projectId/observability/harness',
    queryName: 'query.harness_health',
    respond: ({ services, params, query }) => harnessScorecards(services.db, uuid(params.projectId, 'project'), harnessFilters(query)),
  },
  {
    // Scorecards per harness version (salud-del-harness §9.3): observational cohorts, flagged when they do not overlap in time.
    path: '/api/projects/:projectId/observability/harness/versions.json',
    queryName: 'query.harness_health',
    respond: ({ services, params, query }) => scorecardsByVersion(services.db, uuid(params.projectId, 'project'), harnessFilters(query)),
  },
  {
    path: '/api/projects/:projectId/observability/harness/findings.csv',
    queryName: 'query.harness_health',
    download: { contentType: 'text/csv; charset=utf-8', filename: 'harness-findings.csv' },
    respond: async ({ services, params, query }) => findingsToCsv((await harnessFindingRows(services.db, uuid(params.projectId, 'project'), harnessFilters(query))).rows),
  },
  {
    path: '/api/projects/:projectId/observability/harness/findings.json',
    queryName: 'query.harness_health',
    respond: async ({ services, params, query }) => harnessFindingRows(services.db, uuid(params.projectId, 'project'), harnessFilters(query)),
  },
  {
    // Attention of the person and cost per stage (core queries/attention.ts).
    path: '/api/projects/:projectId/observability/harness/attention.json',
    queryName: 'query.harness_health',
    respond: ({ services, params }) => attentionByStage(services.db, uuid(params.projectId, 'project')),
  },
  {
    // «Is it worth it?»: value delivered against total cost. ?patches= is the DEMIURGO patch count (it has no project id).
    path: '/api/projects/:projectId/observability/harness/worth.json',
    queryName: 'query.harness_health',
    respond: ({ services, params, query }) => {
      const patches = query.patches !== undefined && /^\d+$/.test(query.patches) ? Number(query.patches) : null;
      return worthIt(services.db, uuid(params.projectId, 'project'), { patches });
    },
  },
  {
    // Escapes from design (salud-del-harness §4): what design did not see and building found later.
    path: '/api/projects/:projectId/observability/harness/escapes.json',
    queryName: 'query.harness_health',
    respond: ({ services, params, query }) => harnessEscapes(services.db, uuid(params.projectId, 'project'), harnessFilters(query)),
  },
  {
    // The periodic checks of the harness (salud-del-harness §8): the latest with its regressions and new escapes, and the series.
    path: '/api/projects/:projectId/observability/harness/checks.json',
    queryName: 'query.harness_health',
    respond: ({ services, params }) => harnessChecks(services.db, uuid(params.projectId, 'project')),
  },
  {
    // Phase containment of design against its target; one escapes rules version at a time (`?rules=`, default the latest).
    path: '/api/projects/:projectId/observability/harness/containment.json',
    queryName: 'query.harness_health',
    respond: ({ services, params, query }) => harnessContainment(services.db, uuid(params.projectId, 'project'), { rules: query.rules || undefined }),
  },
  {
    path: '/api/projects/:projectId/observability/harness/escapes.csv',
    queryName: 'query.harness_health',
    download: { contentType: 'text/csv; charset=utf-8', filename: 'harness-escapes.csv' },
    respond: async ({ services, params, query }) => escapesToCsv((await harnessEscapes(services.db, uuid(params.projectId, 'project'), harnessFilters(query))).rows),
  },
  {
    // Every queue decision with its reason (?since= ISO date), for analysing the queue outside the app.
    path: '/api/projects/:projectId/queue/decisions.csv',
    queryName: 'query.harness_health',
    download: { contentType: 'text/csv; charset=utf-8', filename: 'queue-decisions.csv' },
    respond: async ({ services, params, query }) =>
      queueDecisionsToCsv(await queueDecisionRows(services.db, uuid(params.projectId, 'project'), { since: harnessFilters(query).from })),
  },
  {
    path: '/api/projects/:projectId/observability.csv',
    queryName: 'query.records',
    download: { contentType: 'text/csv; charset=utf-8', filename: 'execution-facts.csv' },
    respond: async ({ services, params }) => factsToCsv((await executionFacts(services.db, uuid(params.projectId, 'project'))).facts),
  },
  {
    path: '/api/projects/:projectId/issues',
    queryName: 'query.records',
    respond: ({ services, params }) => issuesList(services.db, uuid(params.projectId, 'project')),
  },
  {
    path: '/api/projects/:projectId/issues/:code',
    queryName: 'query.records',
    respond: ({ services, params }) => issueDetail(services.db, uuid(params.projectId, 'project'), params.code ?? ''),
  },
  {
    // Task forensics (lessons learned): every blameless post-mortem of one task, newest first.
    path: '/api/projects/:projectId/tasks/:code/forensics',
    queryName: 'query.forensics',
    respond: ({ services, params }) => taskForensicsOf(services.db, uuid(params.projectId, 'project'), params.code ?? ''),
  },
  {
    // The latest forensics all together: per task, by class, dimension and piece, ranked improvements and the playbooks.
    path: '/api/projects/:projectId/observability/forensics.json',
    queryName: 'query.forensics',
    respond: ({ services, params }) => forensicsOverview(services.db, uuid(params.projectId, 'project')),
  },
  {
    // The server-composed build brief of a ready record: what Copy brief copies and a request freezes.
    path: '/api/projects/:projectId/records/:code/brief',
    queryName: 'query.records',
    respond: async ({ services, params }) => ({
      brief: await composeBrief(services.db, uuid(params.projectId, 'project'), params.code ?? ''),
    }),
  },
  {
    // The last coherence review of an epic (FDR-KNO-056): what it read, found, dropped and left pending.
    path: '/api/projects/:projectId/records/:code/coherence',
    queryName: 'query.records',
    respond: ({ services, params }) => coherenceStatus(services.db, uuid(params.projectId, 'project'), params.code ?? ''),
  },
  {
    path: '/api/projects/:projectId/versions/:versionId/readiness',
    queryName: 'query.records',
    respond: ({ services, params }) =>
      versionReadiness(services.db, uuid(params.projectId, 'project'), uuid(params.versionId, 'version')),
  },
  {
    path: '/api/projects/:projectId/batches/:batchId',
    queryName: 'query.batches',
    respond: ({ services, params }) => batchDetail(services.db, uuid(params.projectId, 'project'), uuid(params.batchId, 'batch')),
  },
  {
    path: '/api/projects/:projectId/tokens',
    queryName: 'query.tokens',
    respond: ({ services, params }) =>
      services.db
        .selectFrom('agent_tokens')
        .select(['id', 'name', 'state', 'issued_by', 'created_at', 'revoked_at'])
        .where('project_id', '=', uuid(params.projectId, 'project'))
        .orderBy('created_at')
        .execute(),
  },
]);

registerQueries([
  {
    path: '/api/projects/:projectId/knowledge',
    queryName: 'query.knowledge',
    async respond({ services, params }) {
      const projectId = uuid(params.projectId, 'project');
      const freshness = await services.db.transaction().execute((trx) => graphUpToDate(trx, projectId));
      const g = await loadGraph(services.db, projectId);
      const updates = await services.db
        .selectFrom('knowledge_updates')
        .select(['id', 'state', 'trigger', 'failure', 'graph_version_before', 'graph_version_after', 'created_at'])
        .where('project_id', '=', projectId)
        .orderBy('trigger_seq', 'desc')
        .limit(20)
        .execute();
      return {
        graph_version: g.version,
        up_to_date: freshness.upToDate,
        updates_in_progress: freshness.pending,
        fingerprint: graphFingerprint(g),
        current_nodes: g.nodes.filter((n) => n.until === null).length,
        current_edges: g.edges.filter((a) => a.validTo === null).length,
        updates,
      };
    },
  },
  {
    path: '/api/projects/:projectId/knowledge/search',
    queryName: 'query.knowledge',
    async respond({ services, params, query }) {
      const text = (query.q ?? '').trim();
      if (!text) throw new DomainError('validation', 'The search text (q) is missing.');
      return {
        results: await searchKnowledge(services.db, uuid(params.projectId, 'project'), text, 10),
      };
    },
  },
  {
    path: '/api/projects/:projectId/knowledge/rebuild',
    queryName: 'query.knowledge',
    respond: ({ services, params }) => compareRebuild(services.db, uuid(params.projectId, 'project')),
  },
]);

// Queries of the web UI (H1): they reuse the query names of the matrix, so design/data does not change.
const RE_STATE = /^[a-z_]{1,40}$/;

registerQueries([
  {
    path: '/api/projects/:projectId/runs',
    queryName: 'query.runs',
    respond: ({ services, params, query }) =>
      runsList(services.db, uuid(params.projectId, 'project'), {
        ...(query.exploration ? { exploration: uuid(query.exploration, 'exploration') } : {}),
        ...(query.state && RE_STATE.test(query.state) ? { state: query.state } : {}),
      }),
  },
  {
    path: '/api/projects/:projectId/knowledge/graph',
    queryName: 'query.knowledge',
    respond: ({ services, params }) => knowledgeGraph(services.db, uuid(params.projectId, 'project')),
  },
  {
    path: '/api/projects/:projectId/knowledge/idea-assessments',
    queryName: 'query.knowledge',
    respond: ({ services, params }) => ideaAssessments(services.db, uuid(params.projectId, 'project')),
  },
  {
    // What the project's agents consumed, per agent (observability).
    path: '/api/projects/:projectId/usage',
    queryName: 'query.runs',
    respond: ({ services, params }) => projectUsage(services.db, uuid(params.projectId, 'project')),
  },
  {
    // Design stages: the fixed catalog with, for each opened stage, its thread and the coverage
    // of its mandatory questions.
    path: '/api/projects/:projectId/stages',
    queryName: 'query.explorations',
    async respond({ services, params }) {
      const projectId = uuid(params.projectId, 'project');
      const opened = await services.db.selectFrom('stages').selectAll().where('project_id', '=', projectId).execute();
      const questions = await services.db
        .selectFrom('questions')
        .select(['id', 'stage_id', 'stage_key', 'question', 'state', 'conclusion'])
        .where('project_id', '=', projectId)
        .where('stage_key', 'is not', null)
        .orderBy('created_at')
        .execute();
      return STAGES.map((def, position) => {
        const row = opened.find((s) => s.stage === def.key);
        const qs = row ? questions.filter((q) => q.stage_id === row.id) : [];
        return {
          key: def.key,
          title: def.title,
          produces: def.produces,
          moment: def.moment,
          position,
          id: row?.id ?? null,
          state: row?.state ?? 'not_started',
          exploration_id: row?.exploration_id ?? null,
          passed_by: row?.passed_by ?? null,
          passed_at: row?.passed_at ?? null,
          total: row ? qs.length : def.questions.length,
          covered: qs.filter((q) => (COVERED_QUESTION_STATES as readonly string[]).includes(q.state)).length,
          questions: qs.map((q) => ({
            id: q.id,
            key: q.stage_key,
            question: q.question,
            state: q.state,
          })),
        };
      });
    },
  },
  {
    path: '/api/projects/:projectId/changes',
    queryName: 'query.events',
    respond: ({ services, params, query }) =>
      changesSince(services.db, uuid(params.projectId, 'project'), /^\d+$/.test(query.since ?? '') ? String(query.since) : '0'),
  },
  {
    // The code map: features onto files, hotspots and owners (core build/project-map.ts).
    path: '/api/projects/:projectId/code-map',
    queryName: 'query.records',
    respond: ({ services, params }) => loadProjectMap(services.db, uuid(params.projectId, 'project')),
  },
  {
    // The project's repository (core repo/repo.ts): its folder and the commits DEMIURGO made, newest first.
    path: '/api/projects/:projectId/commits',
    queryName: 'query.events',
    async respond({ services, params }) {
      const projectId = uuid(params.projectId, 'project');
      const repo = await services.db
        .selectFrom('project_repos')
        .select('dir')
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      const commits = await services.db
        .selectFrom('project_commits')
        .leftJoin('record_versions', 'record_versions.id', 'project_commits.record_version_id')
        .leftJoin('records', 'records.id', 'record_versions.record_id')
        .select([
          'project_commits.sha',
          'project_commits.message',
          'project_commits.actor',
          'project_commits.files',
          'project_commits.created_at',
          'records.code',
          'record_versions.n',
        ])
        .where('project_commits.project_id', '=', projectId)
        .orderBy('project_commits.created_at', 'desc')
        .limit(50)
        .execute();
      const gh = await services.db
        .selectFrom('project_github')
        .select(['owner', 'repo', 'protection', 'created_at'])
        .where('project_id', '=', projectId)
        .executeTakeFirst();
      return {
        dir: repo ? `${process.env.DEMIURGO_PROJECTS_LABEL ?? 'projects'}/${repo.dir}` : null,
        // The link only: the token never leaves the environment, `github_configured` just says it is there.
        github: gh
          ? {
              owner: gh.owner,
              repo: gh.repo,
              url: `https://github.com/${gh.owner}/${gh.repo}`,
              protection: gh.protection,
              connected_at: gh.created_at,
            }
          : null,
        github_configured: githubConfig() !== null,
        commits: commits.map((c) => ({
          sha: c.sha,
          message: c.message,
          actor: c.actor,
          files: c.files as string[],
          at: c.created_at,
          record: c.code && c.n ? { code: c.code, version: c.n } : null,
        })),
      };
    },
  },
  {
    path: '/api/projects/:projectId/taxonomies',
    queryName: 'query.knowledge',
    respond: ({ services, params }) => taxonomiesList(services.db, uuid(params.projectId, 'project')),
  },
]);
