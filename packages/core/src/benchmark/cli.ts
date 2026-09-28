import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import {
  fingerprint,
  sha256,
  RUBRIC_VERSION,
  DIMENSIONS,
  FINDING_DESCRIPTIONS,
  VERDICT_DESCRIPTIONS,
  INTERPRETATION_RULES,
} from '@demiurgo/domain';
import { planSampleSize } from '../../../domain/src/benchmark-metrics.ts';
import {
  annotationSchema,
  scenarioSchema,
  pilotScenarios,
  proposedAnnotations,
  validateDataset,
  type Annotation,
  type Scenario,
} from './dataset.ts';
import { configSchema, defaultConfig, executeBenchmark, prepareInputs, replayRun, type RunTrace } from './runner.ts';
import { compareReports, reportRun, type Report } from './report.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    dataset: { type: 'string', default: 'evals/knowledge/v2' },
    config: { type: 'string' },
    annotations: { type: 'string' },
    input: { type: 'string' },
    baseline: { type: 'string' },
    candidate: { type: 'string' },
    output: { type: 'string' },
    scenario: { type: 'string' },
    judgment: { type: 'string' },
    'allow-network': { type: 'boolean', default: false },
  },
});
const command = positionals[0];
const required = (value: string | undefined, name: string) => {
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
};
const json = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, 'utf8'));
async function save(file: string, data: unknown) {
  await mkdir(dirname(resolve(file)), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}
const dataset = values.dataset;
async function load() {
  const scenarios = scenarioSchema.array().parse(await json(`${dataset}/scenarios.json`)) as Scenario[];
  const annotations = values.annotations ? annotationSchema.array().parse(await json(values.annotations)) : [];
  return { scenarios, annotations };
}
function assertValid(scenarios: Scenario[], annotations: Annotation[], human = false) {
  const errors = validateDataset(scenarios, annotations, human);
  if (errors.length) throw new Error(errors.join('\n'));
}
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();

async function main(): Promise<void> {
  if (command === 'seed') {
    const scenarios = pilotScenarios();
    const proposals = proposedAnnotations(scenarios);
    assertValid(scenarios, proposals);
    await save(`${dataset}/scenarios.json`, scenarios);
    await save(`${dataset}/proposals.json`, proposals);
    for (const contract of ['A', 'B'] as const)
      for (const engine of ['qwen', 'jev', 'cascade'] as const)
        await save(`${dataset}/configs/${contract}-${engine}.json`, { ...defaultConfig, contract, engine });
    await save(`${dataset}/configs/historical-qwen.json`, {
      ...defaultConfig,
      contract: 'historical',
      engine: 'qwen',
      policy: 'current',
    });
    await save(`${dataset}/rubrics.json`, {
      version: RUBRIC_VERSION,
      interpretation: INTERPRETATION_RULES,
      A: { change: VERDICT_DESCRIPTIONS, idea: FINDING_DESCRIPTIONS },
      B: DIMENSIONS,
    });
    console.log('Wrote 40 proposed scenarios, AI annotations and seven configurations. No human adjudication.');
    return;
  }
  if (command === 'compare') {
    const baseline = (await json(required(values.baseline, 'baseline'))) as Report;
    const candidate = (await json(required(values.candidate, 'candidate'))) as Report;
    await save(required(values.output, 'output'), compareReports(baseline, candidate));
    return;
  }
  if (command === 'plan-size') {
    const input = (await json(required(values.input, 'input'))) as {
      discordance: number;
      targetImprovement: number;
      designEffect: number;
      sourceReportHashes: string[];
    };
    if (!input.sourceReportHashes?.length)
      throw new Error('Planning requires pilot report fingerprints and empirical parameters.');
    await save(required(values.output, 'output'), {
      ...planSampleSize(input.discordance, input.targetImprovement, input.designEffect),
      sourceReportHashes: input.sourceReportHashes,
      statusNote:
        'Planning approximation; requires human review before freezing. The 40 pilot scenarios are excluded from confirmation.',
    });
    return;
  }
  const { scenarios, annotations } = await load();
  assertValid(scenarios, annotations);
  if (command === 'validate') {
    console.log(
      JSON.stringify(
        {
          scenarios: scenarios.length,
          families: new Set(scenarios.map((s) => s.family)).size,
          adjudicated: annotations.filter((a) => a.source === 'human').length,
          modelReady: validateDataset(scenarios, annotations, true).length === 0,
          datasetHash: fingerprint(scenarios),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'cards') {
    const output = required(values.output, 'output');
    await mkdir(output, { recursive: true });
    for (const s of scenarios) {
      const text = [
        `# ${s.id}: ${s.brief}`,
        '',
        `Family: ${s.family}. Partition: ${s.partition}. Graph version: ${s.graph.version}.`,
        '',
        'Review every node before consulting AI proposals. Give independent semantic labels and expected product effects, with verbatim evidence. Mark ambiguity rather than forcing a single class.',
        '',
        '## Taxonomy',
        '```json',
        JSON.stringify(s.taxonomy, null, 2),
        '```',
        '## Approved change',
        '```json',
        JSON.stringify(s.change, null, 2),
        '```',
        '## Unapproved idea',
        s.idea,
        '',
        '## Entire initial graph',
        ...s.graph.nodes.map(
          (n) =>
            `### ${n.ref}: ${n.label}\n\nType: ${n.type}; authority: ${n.authority}; status: ${n.epistemic}; origin: ${JSON.stringify(n.origin)}; categories: ${JSON.stringify(n.categories)}\n\n${n.text}\n`,
        ),
        '## Edges',
        '```json',
        JSON.stringify(s.graph.edges, null, 2),
        '```',
        '## Human judgment',
        'Complete the companion JSON, including every pair, actor human:<name>, review time, evidence and fullGraphReviewed. Save that blind judgment before running reveal.',
      ].join('\n');
      await writeFile(`${output}/${s.id}.md`, `${text}\n`, 'utf8');
      await save(`${output}/${s.id}.blank.json`, {
        scenario: s.id,
        scenarioHash: fingerprint(s),
        source: 'human',
        reviewer: null,
        status: 'corrected',
        fullGraphReviewed: false,
        blindJudgment: null,
        reviewedAt: null,
        categories: {},
        pairs: s.graph.nodes.flatMap((n) =>
          ['change', 'idea'].map((task) => ({
            task,
            ref: n.ref,
            ambiguous: false,
            labels: {},
            effects: [],
            evidence: [],
            explanation: '',
          })),
        ),
      });
    }
    console.log(`Wrote blind cards to ${output}. No proposed labels were included.`);
    return;
  }
  if (command === 'reveal') {
    const s = scenarios.find((scenario) => scenario.id === required(values.scenario, 'scenario'));
    if (!s) throw new Error('Unknown scenario.');
    const blind = annotationSchema.parse(await json(required(values.judgment, 'judgment')));
    // The submitted blind file is immutable evidence; the separate receipt binds its content hash.
    const receipt = { ...blind, blindJudgment: fingerprint(blind) };
    const reviewErrors = validateDataset(scenarios, [receipt], true).filter(
      (error) => !error.endsWith(': missing human adjudication.'),
    );
    if (reviewErrors.length) throw new Error(reviewErrors.join('\n'));
    const proposals = annotationSchema.array().parse(await json(`${dataset}/proposals.json`));
    await save(required(values.output, 'output'), {
      blindJudgmentHash: fingerprint(blind),
      revealedAt: new Date().toISOString(),
      proposal: proposals.find((a) => a.scenario === s.id),
      instruction:
        'Keep the blind file. Record accepted, corrected or ambiguous in a separate final judgment with this blind hash. Only a person may adjudicate.',
    });
    return;
  }
  if (command === 'prepare') {
    const config = configSchema.parse(await json(required(values.config, 'config')));
    await save(required(values.output, 'output'), {
      datasetHash: fingerprint(scenarios),
      config,
      modelReady: validateDataset(scenarios, annotations, true).length === 0,
      note: 'Preview uses exhaustive pairs. Production candidates are recomputed from categories at execution time.',
      inputs: prepareInputs(scenarios, config),
    });
    return;
  }
  if (command === 'run') {
    if (!values['allow-network'])
      throw new Error('Model calls require explicit --allow-network. Use prepare/replay for local work.');
    assertValid(scenarios, annotations, true);
    const config = configSchema.parse(await json(required(values.config, 'config')));
    const output = required(values.output, 'output');
    const { liveEngines } = await import('./providers.ts');
    const tracked = git(
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      'packages/domain/src',
      'packages/core/src/benchmark',
      'packages/core/src/classifier',
      'packages/core/src/providers',
      'packages/core/src/agents',
      'packages/core/agents',
      'packages/core/skills',
    )
      .split('\n')
      .filter(Boolean);
    const contents = await Promise.all(tracked.map(async (path) => ({ path, content: await readFile(path, 'utf8') })));
    const trace = await executeBenchmark(
      scenarios,
      annotations,
      config,
      await liveEngines(config),
      {
        commit: git('rev-parse', 'HEAD'),
        dirty: git('status', '--porcelain').length > 0,
        sourceHash: sha256(JSON.stringify(contents)),
      },
      (t) => save(output, t),
    );
    console.log(JSON.stringify({ status: trace.status, events: trace.events.length, errors: trace.errors.length, output }));
    if (trace.status !== 'complete') process.exitCode = 1;
    return;
  }
  if (command === 'replay' || command === 'report') {
    const saved = (await json(required(values.input, 'input'))) as RunTrace;
    const result = command === 'replay' ? replayRun(scenarios, annotations, saved) : reportRun(scenarios, annotations, saved);
    await save(required(values.output, 'output'), result);
    if (result.status !== 'complete') process.exitCode = 1;
    return;
  }
  throw new Error(
    'Commands: seed, validate, cards, reveal, prepare, run --allow-network, replay, report, compare, plan-size. All inputs and outputs are explicit files.',
  );
}
await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
