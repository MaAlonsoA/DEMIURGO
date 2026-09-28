import { z } from 'zod';
import {
  applyPlan,
  buildPlan,
  currentNodes,
  fingerprint,
  graphFingerprint,
  ideaCandidates,
  itemsForCategories,
  itemsForIdea,
  itemsForVerdicts,
  selectCandidates,
  similarity,
  currentEdges,
  separatedItems,
  RUBRIC_VERSION,
  CONTEXT_VERSION,
  DIMENSIONS,
  FINDING_DESCRIPTIONS,
  VERDICT_DESCRIPTIONS,
  INTERPRETATION_RULES,
  type Candidate,
  type ChoiceResponse,
  type Classifier,
  type ItemChoice,
  type Thresholds,
} from '@demiurgo/domain';
import {
  POLICY_VERSION,
  separatedEffects,
  validateResponses,
  type Effect,
  type Task,
} from '../../../domain/src/benchmark-policy.ts';
import { shuffled } from '../../../domain/src/benchmark-metrics.ts';
import { validateDataset, type Annotation, type Scenario } from './dataset.ts';

const thresholdSchema = z
  .object({ high: z.number().min(0).max(1), medium: z.number().min(0).max(1) })
  .strict()
  .refine((t) => t.medium <= t.high);
export const configSchema = z
  .object({
    contract: z.enum(['A', 'B', 'historical']),
    engine: z.enum(['qwen', 'jev', 'cascade']),
    policy: z.enum(['current', 'pending']),
    retrieval: z.enum(['isolated', 'production', 'exhaustive']),
    categories: z.enum(['adjudicated', 'predicted']),
    condition: z.enum(['controlled', 'operational']),
    partition: z.enum(['dev', 'validation', 'confirmatory']),
    repetitions: z.number().int().min(1).max(5),
    /** Optional sample: only these scenarios of the partition run (e.g. a reviewed subset). */
    scenarios: z.array(z.string().min(1)).min(1).optional(),
    seed: z.number().int().nonnegative(),
    thresholds: z.object({ category: thresholdSchema, change: thresholdSchema, idea: thresholdSchema }).strict(),
    qwen: z.object({ model: z.string().min(1), effort: z.string().nullable(), configPath: z.string().min(1) }).strict(),
    jev: z.object({ model: z.string().min(1) }).strict(),
  })
  .strict()
  .refine(
    (c) => c.contract !== 'historical' || (c.engine === 'qwen' && c.policy === 'current'),
    'Historical mode reproduces Qwen/current only.',
  );
export type Config = z.infer<typeof configSchema>;
export const defaultConfig: Config = {
  contract: 'A',
  engine: 'qwen',
  policy: 'pending',
  retrieval: 'production',
  categories: 'predicted',
  condition: 'controlled',
  partition: 'dev',
  repetitions: 5,
  seed: 42,
  thresholds: { category: { high: 0.8, medium: 0.55 }, change: { high: 0.8, medium: 0.55 }, idea: { high: 0.8, medium: 0.55 } },
  qwen: { model: 'qwen-local/qwen3_8-27b', effort: 'medium', configPath: '/Users/marcos/.config/opencode/opencode.json' },
  jev: { model: 'jev-latest' },
};
export const contractHash = () =>
  fingerprint({
    rubric: RUBRIC_VERSION,
    context: CONTEXT_VERSION,
    policy: POLICY_VERSION,
    DIMENSIONS,
    FINDING_DESCRIPTIONS,
    VERDICT_DESCRIPTIONS,
    INTERPRETATION_RULES,
  });
/** The scenarios a configuration runs, in dataset order: its partition, or the sample within it. */
export const selectedScenarios = (scenarios: readonly Scenario[], config: Config): Scenario[] =>
  scenarios.filter((s) => s.partition === config.partition && (!config.scenarios || config.scenarios.includes(s.id)));
/**
 * Responses never depend on labels unless categories come from the reference. Such a run is blind:
 * it needs no reference to execute, records `adjudicationHash: null`, and is scored later.
 */
export const isBlind = (config: Config): boolean => config.categories !== 'adjudicated';
export const configurationId = (config: Config) => fingerprint({ config, contractHash: contractHash() });
export type CallTrace = {
  stage: 'category' | Task;
  role: 'primary' | 'reviewer';
  items: ItemChoice[];
  responses: ChoiceResponse[];
  errors: string[];
  durationMs: number;
  classifier: string;
  telemetry: unknown[];
};
export type Outcome = {
  task: Task;
  ref: string;
  selected: boolean;
  omissionReason: string | null;
  effects: Effect[];
  labels: Record<string, string>;
  confidence: number | null;
  confidences: Record<string, number>;
  invalid: boolean;
  abstained: boolean;
};
export type EventTrace = {
  scenario: string;
  family: string;
  repetition: number;
  order: number;
  calls: CallTrace[];
  categories: Record<string, string>;
  candidates: Record<Task, Candidate[]>;
  outcomes: Outcome[];
  graphHash: string;
  durationMs: number;
};
export type RunTrace = {
  version: 1;
  datasetHash: string;
  /** Null for a blind run (see `isBlind`); otherwise the reference the run depended on. */
  adjudicationHash: string | null;
  contractHash: string;
  configurationId: string;
  config: Config;
  commit: string;
  dirty: boolean;
  sourceHash: string;
  startedAt: string;
  status: 'running' | 'complete' | 'failed';
  errors: string[];
  events: EventTrace[];
};
export type Engines = { primary: Classifier; reviewer?: Classifier; takeTelemetry?: () => unknown[] };

export function candidatesFor(s: Scenario, config: Config, categories: Record<string, string>, task: Task): Candidate[] {
  if (config.retrieval !== 'production')
    return currentNodes(s.graph)
      .filter(
        (n) =>
          config.retrieval === 'isolated' ||
          task === 'idea' ||
          !new Set([
            s.change.main.ref,
            ...s.change.companions.map((companion) => companion.ref),
            ...s.change.supersedes,
            ...s.change.edges.map((e) => e.to),
          ]).has(n.ref),
      )
      .map((n) => ({ ref: n.ref, type: n.type, label: n.label, text: n.text, reason: 'exhaustive, untruncated' }));
  return task === 'change' ? selectCandidates(s.graph, s.change, categories) : ideaCandidates(s.graph, s.idea);
}
export function omissionReason(s: Scenario, categories: Record<string, string>, task: Task, ref: string): string {
  const node = s.graph.nodes.find((candidate) => candidate.ref === ref)!;
  if (task === 'change') {
    if (s.change.supersedes.includes(ref)) return 'version_precedence';
    if (ref === s.change.main.ref || s.change.companions.some((companion) => companion.ref === ref)) return 'own_node';
    if (s.change.edges.some((edge) => edge.to === ref)) return 'declared_relation';
  }
  if (node.type === 'criterion') return 'excluded_criterion';
  if (task === 'idea')
    return similarity(s.idea, `${node.label}. ${node.text}`) >= 0.05 ? 'candidate_limit' : 'below_similarity_threshold';
  const seeds = new Set([...s.change.supersedes, ...s.change.edges.map((edge) => edge.to)]);
  const neighbor = currentEdges(s.graph).some(
    (edge) => (seeds.has(edge.from) && edge.to === ref) || (seeds.has(edge.to) && edge.from === ref),
  );
  const category = Object.entries(categories).some(([axis, value]) => value !== 'other' && node.categories[axis] === value);
  const lexical = similarity(`${s.change.main.label}. ${s.change.main.text}`, `${node.label}. ${node.text}`) >= 0.08;
  return neighbor || category || lexical ? 'candidate_limit' : 'no_neighbor_category_or_text_match';
}
export function pairItems(s: Scenario, config: Config, task: Task, candidates: Candidate[]): ItemChoice[][] {
  const base =
    task === 'change'
      ? itemsForVerdicts(s.change, candidates, config.contract !== 'historical')
      : itemsForIdea(s.idea, candidates, config.contract !== 'historical');
  return base.map((item) => (config.contract === 'B' ? separatedItems(item, task) : [item]));
}
export function prepareInputs(scenarios: readonly Scenario[], config: Config) {
  return selectedScenarios(scenarios, config).map((s) => ({
    scenario: s.id,
    categories: itemsForCategories(s.change, s.taxonomy, config.contract !== 'historical'),
    tasks: (['change', 'idea'] as const).map((task) => ({
      task,
      exhaustivePairs: pairItems(
        s,
        { ...config, retrieval: 'exhaustive' },
        task,
        candidatesFor(s, { ...config, retrieval: 'exhaustive' }, {}, task),
      ),
    })),
  }));
}
function batches(groups: ItemChoice[][], config: Config): ItemChoice[][] {
  return config.condition === 'controlled' ? groups : groups.length ? [groups.flat()] : [];
}
export function finalResponses(calls: readonly CallTrace[], task: CallTrace['stage']): Map<string, ChoiceResponse> {
  const map = new Map<string, ChoiceResponse>();
  for (const call of calls.filter((c) => c.stage === task)) {
    for (const item of call.items) map.delete(item.id);
    if (!call.errors.length) for (const r of validateResponses(call.items, call.responses).valid) map.set(r.id, r);
  }
  return map;
}
function reviewGroups(
  groups: ItemChoice[][],
  calls: readonly CallTrace[],
  task: CallTrace['stage'],
  thresholds: Thresholds,
  pendingPolicy: boolean,
): ItemChoice[][] {
  const map = finalResponses(calls, task);
  return groups.filter((group) => {
    const rows = group.map((i) => map.get(i.id));
    if (rows.some((r) => !r)) return false;
    const relation = rows.find((row) => row!.id.endsWith('::relation'));
    if (relation && task !== 'category') {
      const dimensions = {
        relation: relation.choice,
        compatibility: rows.find((row) => row!.id.endsWith('::compatibility'))!.choice,
        ...(task === 'change' ? { action: rows.find((row) => row!.id.endsWith('::action'))!.choice } : {}),
      };
      if (separatedEffects(task, dimensions, 1).invalid) return false;
    }
    const min = Math.min(...rows.map((r) => r!.confidence));
    return (
      min >= thresholds.medium &&
      min < thresholds.high &&
      rows.every((r) => r!.choice !== 'insufficient_context' && !(pendingPolicy && task === 'change' && r!.choice === 'other'))
    );
  });
}
function categoryValues(
  s: Scenario,
  config: Config,
  calls: readonly CallTrace[],
  adjudication?: Annotation,
): Record<string, string> {
  if (config.categories === 'adjudicated') return { ...adjudication!.categories };
  const map = finalResponses(calls, 'category');
  return Object.fromEntries(
    s.taxonomy.axes.flatMap((axis) => {
      const r = map.get(axis.code);
      return r && r.confidence >= config.thresholds.category.high ? [[axis.code, r.choice]] : [];
    }),
  );
}
function aEffects(s: Scenario, config: Config, task: Task, response: ChoiceResponse): Effect[] {
  if (config.policy === 'pending' && (response.confidence < config.thresholds[task].high || response.choice === 'other'))
    return ['pending'];
  if (task === 'idea')
    return (
      (
        {
          none: ['preserve'],
          relates: ['relation'],
          conflicts: ['conflict'],
          inconsistent: ['assumption'],
          duplicates: ['duplicate'],
        } as Record<string, Effect[]>
      )[response.choice] ?? ['pending']
    );
  const plan = buildPlan(s.graph, s.change, {}, [response], s.graph.version + 1, config.thresholds.change);
  if (plan.reviews.some((r) => r.ref === response.id)) return ['review'];
  if (plan.newEdges.some((e) => e.to === response.id)) return ['relation'];
  if (plan.invalidate.includes(response.id)) return ['invalidate'];
  return plan.notApplied.length ? ['pending'] : ['preserve'];
}
export function replayEvent(s: Scenario, config: Config, event: EventTrace, adjudication?: Annotation): EventTrace {
  const calls = event.calls.map((c) => ({
    ...c,
    errors: [...new Set([...c.errors, ...validateResponses(c.items, c.responses).errors])],
  }));
  const categories = categoryValues(s, config, calls, adjudication);
  const candidates = {
    change: candidatesFor(s, config, categories, 'change'),
    idea: candidatesFor(s, config, categories, 'idea'),
  };
  const outcomes: Outcome[] = [];
  const structuralInvalidations = new Set(buildPlan(s.graph, s.change, categories, [], s.graph.version + 1).invalidate);
  for (const task of ['change', 'idea'] as const) {
    const responses = finalResponses(calls, task);
    for (const node of currentNodes(s.graph)) {
      const candidate = candidates[task].find((c) => c.ref === node.ref);
      const structural = task === 'change' && structuralInvalidations.has(node.ref);
      if (!candidate) {
        outcomes.push({
          task,
          ref: node.ref,
          selected: false,
          omissionReason: structural ? 'version_precedence' : omissionReason(s, categories, task, node.ref),
          effects: structural ? ['invalidate'] : ['preserve'],
          labels: {},
          confidence: null,
          confidences: {},
          invalid: false,
          abstained: false,
        });
        continue;
      }
      const items = pairItems(s, config, task, [candidate])[0]!;
      const rows = items.map((i) => responses.get(i.id));
      const invalid = rows.some((r) => !r);
      const labels = Object.fromEntries(
        rows.filter((r) => r !== undefined).map((r) => [config.contract === 'B' ? r.id.split('::').at(-1)! : 'A', r.choice]),
      );
      const confidence = invalid ? null : Math.min(...rows.map((r) => r!.confidence));
      const result = invalid
        ? { effects: ['pending'] as Effect[], invalid: true }
        : config.contract === 'B'
          ? separatedEffects(
              task,
              {
                relation: labels.relation!,
                compatibility: labels.compatibility!,
                ...(task === 'change' ? { action: labels.action! } : {}),
              },
              confidence!,
              config.thresholds[task],
            )
          : { effects: aEffects(s, config, task, rows[0]!), invalid: false };
      outcomes.push({
        task,
        ref: node.ref,
        selected: true,
        omissionReason: structural ? 'version_precedence' : candidate.text.length < node.text.length ? 'text_truncated' : null,
        ...result,
        labels,
        confidence,
        confidences: Object.fromEntries(
          rows
            .filter((row) => row !== undefined)
            .map((row) => [config.contract === 'B' ? row.id.split('::').at(-1)! : 'A', row.confidence]),
        ),
        abstained: result.effects.includes('pending'),
      });
    }
  }
  // Project only the approved structural change; derived effects cannot accept authority.
  const plan = buildPlan(s.graph, s.change, categories, [], s.graph.version + 1);
  for (const o of outcomes.filter((outcome) => outcome.task === 'change')) {
    if (o.effects.includes('relation'))
      plan.newEdges.push({ type: 'related', from: s.change.main.ref, to: o.ref, validFrom: s.graph.version + 1, validTo: null });
    if (o.effects.includes('invalidate') && !structuralInvalidations.has(o.ref)) {
      if (s.graph.nodes.find((n) => n.ref === o.ref)?.authority) throw new Error('Automatic authority mutation is forbidden.');
      plan.invalidate.push(o.ref);
      for (const e of s.graph.edges.filter((edge) => edge.validTo === null && (edge.from === o.ref || edge.to === o.ref)))
        plan.invalidatedEdges.push(e);
    }
  }
  return {
    ...event,
    calls,
    categories,
    candidates,
    outcomes,
    graphHash: graphFingerprint(applyPlan(s.graph, plan, s.graph.version + 1)),
  };
}
export async function executeBenchmark(
  scenarios: Scenario[],
  annotations: Annotation[],
  configInput: Config,
  engines: Engines,
  provenance: Pick<RunTrace, 'commit' | 'dirty' | 'sourceHash'>,
  checkpoint?: (trace: RunTrace) => Promise<void>,
): Promise<RunTrace> {
  const config = configSchema.parse(configInput);
  const selected = selectedScenarios(scenarios, config);
  const errors = validateDataset(scenarios, annotations, isBlind(config) ? false : new Set(selected.map((s) => s.id)));
  if (errors.length) throw new Error(errors.join('\n'));
  if (!selected.length) throw new Error('No scenarios in the selected partition.');
  if (config.engine === 'cascade' && !engines.reviewer) throw new Error('Cascade requires a reviewer.');
  const trace: RunTrace = {
    version: 1,
    datasetHash: fingerprint(scenarios),
    adjudicationHash: isBlind(config) ? null : fingerprint(annotations),
    contractHash: contractHash(),
    configurationId: configurationId(config),
    config,
    ...provenance,
    startedAt: new Date().toISOString(),
    status: 'running',
    errors: [],
    events: [],
  };
  for (let repetition = 0; repetition < config.repetitions; repetition++)
    for (const [order, s] of shuffled(selected, config.seed + repetition).entries()) {
      const start = Date.now();
      const a = annotations.find((v) => v.scenario === s.id);
      const event: EventTrace = {
        scenario: s.id,
        family: s.family,
        repetition,
        order,
        calls: [],
        categories: {},
        candidates: { change: [], idea: [] },
        outcomes: [],
        graphHash: '',
        durationMs: 0,
      };
      trace.events.push(event);
      await checkpoint?.(trace);
      const ask = async (stage: CallTrace['stage'], role: CallTrace['role'], items: ItemChoice[]) => {
        const engine = role === 'primary' ? engines.primary : engines.reviewer!;
        const call: CallTrace = {
          stage,
          role,
          items: structuredClone(items),
          responses: [],
          errors: [],
          durationMs: 0,
          classifier: engine.id,
          telemetry: [],
        };
        event.calls.push(call);
        await checkpoint?.(trace);
        const before = Date.now();
        try {
          call.responses = await engine.choice(structuredClone(items));
          call.errors = validateResponses(items, call.responses).errors;
        } catch (error) {
          call.errors = [error instanceof Error ? error.message : String(error)];
        }
        call.durationMs = Date.now() - before;
        call.telemetry = engines.takeTelemetry?.() ?? [];
        await checkpoint?.(trace);
      };
      const classify = async (stage: CallTrace['stage'], groups: ItemChoice[][], thresholds: Thresholds) => {
        for (const batch of batches(groups, config)) await ask(stage, 'primary', batch);
        if (config.engine === 'cascade')
          for (const batch of batches(reviewGroups(groups, event.calls, stage, thresholds, config.policy === 'pending'), config))
            await ask(stage, 'reviewer', batch);
      };
      if (config.categories === 'predicted' && config.retrieval === 'production')
        await classify(
          'category',
          itemsForCategories(s.change, s.taxonomy, config.contract !== 'historical').map((i) => [i]),
          config.thresholds.category,
        );
      const categories = categoryValues(s, config, event.calls, a);
      for (const task of ['change', 'idea'] as const)
        await classify(task, pairItems(s, config, task, candidatesFor(s, config, categories, task)), config.thresholds[task]);
      event.durationMs = Date.now() - start;
      Object.assign(event, replayEvent(s, config, event, a));
      await checkpoint?.(trace);
    }
  trace.errors = trace.events.flatMap((e) =>
    e.calls.flatMap((c) => c.errors.map((error) => `${e.scenario}/${e.repetition}/${c.stage}: ${error}`)),
  );
  trace.status = trace.errors.length || trace.events.some((e) => e.outcomes.some((o) => o.invalid)) ? 'failed' : 'complete';
  await checkpoint?.(trace);
  return trace;
}

/** Reject trace drift rather than silently scoring a new experiment as a replay. */
export function replayRun(scenarios: Scenario[], annotations: Annotation[], trace: RunTrace): RunTrace {
  configSchema.parse(trace.config);
  const selected = selectedScenarios(scenarios, trace.config);
  const errors = validateDataset(scenarios, annotations, isBlind(trace.config) ? false : new Set(selected.map((s) => s.id)));
  if (errors.length) throw new Error(errors.join('\n'));
  if (
    trace.datasetHash !== fingerprint(scenarios) ||
    (trace.adjudicationHash === null ? !isBlind(trace.config) : trace.adjudicationHash !== fingerprint(annotations)) ||
    trace.contractHash !== contractHash() ||
    trace.configurationId !== configurationId(trace.config)
  )
    throw new Error('Trace fingerprints do not match the dataset, adjudication, rubric or configuration.');
  const expected = selected.length * trace.config.repetitions;
  const keys = trace.events.map((e) => `${e.scenario}:${e.repetition}`);
  if (trace.events.length !== expected || new Set(keys).size !== expected || trace.status === 'running')
    throw new Error('Incomplete or duplicate event trace.');
  const events = trace.events.map((e) => {
    const s = selected.find((scenario) => scenario.id === e.scenario);
    if (!s || e.family !== s.family || e.repetition < 0 || e.repetition >= trace.config.repetitions)
      throw new Error('Unexpected event in trace.');
    const result = replayEvent(
      s,
      trace.config,
      e,
      annotations.find((a) => a.scenario === e.scenario),
    );
    const ordered = shuffled(selected, trace.config.seed + e.repetition);
    if (ordered[e.order]?.id !== s.id) throw new Error('Saved order differs from the recorded seed.');
    const expectedCalls: Pick<CallTrace, 'stage' | 'role' | 'items'>[] = [];
    const expectStage = (stage: CallTrace['stage'], groups: ItemChoice[][]) => {
      for (const items of batches(groups, trace.config)) expectedCalls.push({ stage, role: 'primary', items });
      if (trace.config.engine === 'cascade')
        for (const items of batches(
          reviewGroups(
            groups,
            e.calls.filter((call) => call.role === 'primary'),
            stage,
            trace.config.thresholds[stage],
            trace.config.policy === 'pending',
          ),
          trace.config,
        ))
          expectedCalls.push({ stage, role: 'reviewer', items });
    };
    if (trace.config.categories === 'predicted' && trace.config.retrieval === 'production')
      expectStage(
        'category',
        itemsForCategories(s.change, s.taxonomy, trace.config.contract !== 'historical').map((item) => [item]),
      );
    for (const task of ['change', 'idea'] as const) expectStage(task, pairItems(s, trace.config, task, result.candidates[task]));
    if (fingerprint(expectedCalls) !== fingerprint(e.calls.map(({ stage, role, items }) => ({ stage, role, items }))))
      throw new Error('Saved inputs or batch schedule differ from the shared constructors and cascade policy.');
    return result;
  });
  const failed = events.some((e) => e.calls.some((c) => c.errors.length) || e.outcomes.some((o) => o.invalid));
  return { ...trace, events, status: failed ? 'failed' : 'complete' };
}
