// Read-only queries the web UI uses (brief of the H1 frontend, §4): they reuse the query names of
// the matrix (query.knowledge, query.runs, query.batches, query.records, query.explorations).

import { readTree } from '@demiurgo/design';
import { beforeAll, describe, expect, it } from 'vitest';
import { useApi } from './support/api.ts';

const api = useApi();
let projectId = '';
let batchId = '';
let importCounts: Record<string, number> = {};

type Response = { entity_id: string; result: Record<string, unknown> };

async function command(name: string, data: unknown, entityId?: string): Promise<Response> {
  const r = await api().person.request('POST', `/api/projects/${projectId}/commands/${name}`, {
    ...(entityId ? { entity_id: entityId } : {}),
    data,
  });
  if (r.statusCode !== 200) throw new Error(`${name}: ${r.body}`);
  return r.json<Response>();
}

async function get<T>(path: string): Promise<T> {
  const r = await api().person.request('GET', `/api/projects/${projectId}${path}`);
  if (r.statusCode !== 200) throw new Error(`${path}: ${r.statusCode} ${r.body}`);
  return r.json<T>();
}

beforeAll(async () => {
  const p = await api().person.request('POST', '/api/projects', { name: 'Web queries' });
  projectId = p.json<{ project_id: string }>().project_id;
  const tree = await readTree('design');
  const imported = await command('design.import', { tree: Object.fromEntries(tree), origin: 'design' });
  batchId = imported.entity_id;
  importCounts = imported.result.counts as Record<string, number>;
});

describe('API: queries of the web UI', () => {
  it('AC-INT-001-03 the detail of an import batch carries the origin counts and the package counts as data', async () => {
    const batch = await get<{ kind: string; import_counts: { origin: Record<string, number>; package: Record<string, number> } }>(
      `/batches/${batchId}`,
    );
    expect(batch.kind).toBe('import');
    expect(batch.import_counts.origin).toEqual(importCounts);
    expect(batch.import_counts.package).toEqual(importCounts);
  });

  it('AC-INT-001-17 after ratifying, the graph lists its current nodes and edges with type, reference, status and taxonomy area', async () => {
    await command('batch.accept_package', {}, batchId);
    // Ratifying approves nothing: the taxonomy is proposed. Once approved, what changes afterwards is classified.
    const taxonomy = await get<{ id: string; state: string }[]>('/taxonomies');
    expect(taxonomy[0]?.state).toBe('draft');
    await command('taxonomy.approve', {}, taxonomy[0]?.id);
    const dec = await get<{ versions: { id: string }[] }>('/records/DEC-PLN-001');
    await command('record_version.approve', {}, dec.versions[0]?.id);
    const graph = await get<{
      graph_version: number;
      nodes: {
        ref: string;
        type: string;
        label: string;
        epistemic_status: string;
        areas: Record<string, string>;
        state: string;
        record: { code: string; version: number } | null;
      }[];
      edges: { type: string; from: string; to: string; state: string }[];
    }>('/knowledge/graph');
    expect(graph.graph_version).toBeGreaterThan(0);
    const fdr = graph.nodes.find((n) => n.ref === 'FDR-DIS-001@1');
    expect(fdr).toMatchObject({ type: 'fdr', state: 'current', record: { code: 'FDR-DIS-001', version: 1 } });
    expect(typeof fdr?.label).toBe('string');
    expect(fdr?.epistemic_status).toBe('proposed');
    expect(graph.nodes.find((n) => n.ref === 'DEC-PLN-001@1')?.epistemic_status).toBe('confirmed');
    const criterion = graph.nodes.find((n) => n.ref.startsWith('AC-DIS-001-01@'));
    expect(criterion?.record).toEqual({ code: 'FDR-DIS-001', version: 1 });
    expect(graph.nodes.some((n) => Object.keys(n.areas).length > 0)).toBe(true);
    expect(graph.edges.some((e) => e.type === 'contains' && e.from === 'FDR-DIS-001@1')).toBe(true);
  });

  it('AC-INT-001-17 the taxonomies come with their state and their content', async () => {
    const taxonomies =
      await get<{ id: string; code: string; version: number; state: string; axes: unknown; sections: unknown }[]>('/taxonomies');
    expect(taxonomies).toHaveLength(1);
    expect(taxonomies[0]).toMatchObject({ code: 'TAX-001', version: 1, state: 'approved', approved_by: 'human:ana' });
    expect(Array.isArray(taxonomies[0]?.axes) || typeof taxonomies[0]?.axes === 'object').toBe(true);
  });

  it('AC-INT-001-17 the idea assessments come with their verdict and the cited node or record', async () => {
    const token = String((await command('agent_token.issue', { name: 'claude-code' })).result.token);
    const agent = api().agent(token);
    const submitted = await agent.request('POST', `/api/projects/${projectId}/commands/batch.submit`, {
      data: {
        proposals: [
          {
            type: 'decision',
            payload: {
              title: 'Aceptación humana de lo que proponga un agente',
              context: 'La IA propone y la persona decide.',
              decision: 'Ninguna salida de IA cambia un estado de autoridad: una persona acepta cada propuesta.',
              consequences: 'Toda propuesta pasa por la bandeja.',
            },
          },
        ],
      },
    });
    expect(submitted.statusCode).toBe(200);
    const assessments =
      await get<
        {
          id: string;
          proposal: { id: string; type: string; title: string | null; batch_id: string };
          findings: {
            verdict: string;
            citation: string;
            label: string | null;
            record: { code: string; version: number } | null;
          }[];
          graph_version: number;
        }[]
      >('/knowledge/idea-assessments');
    const mine = assessments.find((a) => a.proposal.batch_id === submitted.json<{ entity_id: string }>().entity_id);
    expect(mine?.proposal).toMatchObject({ type: 'decision', title: 'Aceptación humana de lo que proponga un agente' });
    expect(Array.isArray(mine?.findings)).toBe(true);
    for (const f of mine?.findings ?? []) {
      expect(['duplicates', 'contradicts', 'relates']).toContain(f.verdict);
      expect(f.citation).toMatch(/@\d+$/);
    }
  });

  it('AC-INT-001-10 the runs list has state, action, thread, model, what it retries and dates, filterable by thread and state', async () => {
    const e = await command('exploration.open', { purpose: 'Runs in a thread' });
    const chat = await command('run.request', { action: 'exploration_chat', scope: { type: 'exploration', id: e.entity_id } });
    await command('run.request', { action: 'echo', scope: { type: 'project' }, input: { text: 'x' } });
    const all =
      await get<
        {
          id: string;
          state: string;
          action: string;
          exploration_id: string | null;
          model: string | null;
          retry_of: string | null;
          created_at: string;
          context_pack_hash: string | null;
          batch_id: string | null;
        }[]
      >('/runs');
    expect(all.length).toBeGreaterThanOrEqual(2);
    const found = all.find((r) => r.id === chat.entity_id);
    expect(found).toMatchObject({ action: 'exploration_chat', exploration_id: e.entity_id, retry_of: null, batch_id: null });
    expect(found?.context_pack_hash).toMatch(/^[0-9a-f]{64}$/);
    const inThread = await get<{ id: string }[]>(`/runs?exploration=${e.entity_id}`);
    expect(inThread.map((r) => r.id)).toEqual([chat.entity_id]);
    const queued = await get<{ state: string }[]>('/runs?state=queued');
    expect(queued.every((r) => r.state === 'queued')).toBe(true);
  });

  it('AC-INT-001-04 product rows, records and threads carry what the cards show: summary, checks, who and when', async () => {
    const state = await get<{
      designs: {
        code: string;
        summary: string;
        checks: number;
        updated_at: string;
        updated_by: string;
        latest_id: string;
        current_id: string | null;
      }[];
    }>('/state');
    const fdr = state.designs.find((d) => d.code === 'FDR-DIS-001');
    expect(fdr?.summary.length).toBeGreaterThan(0);
    expect(fdr?.checks).toBeGreaterThan(0);
    expect(fdr?.updated_by).toMatch(/^human:/);
    expect(fdr?.current_id).toBeNull();

    const record = await get<{
      versions: { created_at: string; origin_exploration: string | null; inferred_questions: unknown[] }[];
    }>('/records/FDR-DIS-001');
    expect(record.versions[0]?.created_at).toBeTruthy();
    expect(record.versions[0]?.origin_exploration).toBeNull();
    expect(record.versions[0]?.inferred_questions).toEqual([]);

    const threads = await get<{ id: string; purpose: string; open_questions: number; last_activity: string }[]>('/explorations');
    const thread = threads.find((t) => t.purpose === 'Runs in a thread');
    expect(thread?.open_questions).toBe(0);
    expect(thread?.last_activity).toBeTruthy();
  });

  it('AC-INT-001-11 the inbox says which records each link joins, and what each batch and proposal depends on', async () => {
    const dec = await get<{ id: string; versions: { sections: { title: string; content: string }[] }[] }>('/records/DEC-PLN-001');
    const v2 = await command('record_version.create', {
      record_id: dec.id,
      title: 'Reimplementar DEMIURGO como v2 (revisada)',
      sections: dec.versions[0]?.sections ?? [],
      change_note: 'Revisión.',
    });
    await command('record_version.approve', {}, v2.entity_id);
    const inbox = await get<{
      links_under_review: {
        type: string;
        from_code: string;
        from_n: number;
        to_code: string;
        to_n: number;
        from_title: string;
      }[];
      batches: { dependencies: unknown[]; proposals: { dependencies: unknown[] }[] }[];
    }>('/inbox');
    const link = inbox.links_under_review.find((l) => l.to_code === 'DEC-PLN-001');
    expect(link).toMatchObject({ type: 'based_on', to_n: 1 });
    expect(link?.from_code).toMatch(/^(FDR|ADR)-/);
    expect(link?.from_n).toBe(1);
    expect(typeof link?.from_title).toBe('string');
    for (const b of inbox.batches) {
      expect(Array.isArray(b.dependencies)).toBe(true);
      for (const x of b.proposals) expect(Array.isArray(x.dependencies)).toBe(true);
    }
    const state = await get<{ designs: { code: string; origin_exploration: string | null }[] }>('/state');
    expect(state.designs.every((d) => d.origin_exploration === null)).toBe(true);
  });

  it('AC-INT-001-04 each link of a version says which record, version, title and state it points to', async () => {
    const record = await get<{
      versions: {
        links: { type: string; to_code: string; to_n: number; to_title: string; to_state: string; to_current: boolean }[];
      }[];
    }>('/records/FDR-DIS-001');
    const basedOn = record.versions[0]?.links.find((l) => l.type === 'based_on');
    expect(basedOn).toMatchObject({ to_code: 'DEC-PLN-001', to_n: 1, to_state: 'superseded', to_current: false });
    expect(basedOn?.to_title.length).toBeGreaterThan(0);
  });
});
