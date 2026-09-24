// Pieces of the official `claude -p` CLI shared by the Claude provider (providers/claude.ts): the
// schema as the CLI accepts it, finding the executable (also behind an npm `.cmd` shim on Windows),
// the length of the command line, and the normalization of what the CLI prints. The structured
// output is delivered unvalidated: the system validates it (I7).

import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AgentResult, Usage } from '@demiurgo/domain';
import { z } from 'zod';
import { type ProcessEnd, readVariable } from './process.ts';

export const CLAUDE_PROVIDER_ID = 'claude';

export type ClaudeExecutable = { executable: string; previousArgs: readonly string[] };

// --- Schema -------------------------------------------------------------------------------------

const UNSUPPORTED_DRAFTS = /json-schema\.org\/draft\/(2019-09|2020-12)\/schema/;

/**
 * The CLI validates `--json-schema` against draft-07 and rejects the whole schema if it declares
 * `$schema` 2019-09 or 2020-12 ("no schema with key or ref"). In that case only the
 * declaration is dropped; the rest of the schema is sent as is.
 */
export function schemaForCli(schema: Record<string, unknown>): Record<string, unknown> {
  const declared = schema.$schema;
  if (typeof declared !== 'string' || !UNSUPPORTED_DRAFTS.test(declared)) return schema;
  return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$schema'));
}

// --- Executable resolution --------------------------------------------------------------

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Target of an npm or pnpm `.cmd` shim: Node can't launch a `.cmd` without a shell, so what
 * the shim would run is launched instead (an `.exe` directly, or a `.js` with this same Node).
 */
export function npmShimTarget(content: string, shimDir: string): ClaudeExecutable | undefined {
  const candidates = [...content.matchAll(/"%~?dp0%?\\([^"%]+?\.(exe|cjs|mjs|js))"/gi)].filter(
    (m) => !/(^|\\)node\.exe$/i.test(m[1] ?? ''),
  );
  const last = candidates.at(-1);
  const relative = last?.[1];
  if (relative === undefined) return undefined;
  const path = join(shimDir, relative);
  return last?.[2]?.toLowerCase() === 'exe'
    ? { executable: path, previousArgs: [] }
    : { executable: process.execPath, previousArgs: [path] };
}

/** Looks up `claude` on the PATH: on Windows, `claude.exe` or the target of `claude.cmd`. */
export function resolveClaudeExecutable(
  environment: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
): Promise<ClaudeExecutable | undefined> {
  return resolveExecutable('claude', environment, platform);
}

/** Looks up a CLI on the PATH: on Windows, `<name>.exe` or the target of `<name>.cmd`. */
export async function resolveExecutable(
  name: string,
  environment: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
): Promise<ClaudeExecutable | undefined> {
  const windows = platform === 'win32';
  const directories = (readVariable(environment, 'PATH') ?? '').split(windows ? ';' : ':');
  const names = windows ? [`${name}.exe`, `${name}.cmd`] : [name];
  for (const raw of directories) {
    const dir = raw.trim().replace(/^"(.*)"$/, '$1');
    if (!dir) continue;
    for (const file of names) {
      const path = join(dir, file);
      if (!(await isFile(path))) continue;
      if (!file.endsWith('.cmd')) return { executable: path, previousArgs: [] };
      const target = npmShimTarget(await readFile(path, 'utf8'), dirname(path));
      if (target && (await isFile(target.previousArgs[0] ?? target.executable))) return target;
    }
  }
  return undefined;
}

/** Length of the command line Node builds: quotes, a space, and one escape per `"` or `\`. */
export function lineLength(executable: string, args: readonly string[]): number {
  return [executable, ...args].reduce((total, a) => total + a.length + (a.match(/["\\]/g)?.length ?? 0) + 3, 0);
}

// --- Normalizing the CLI's output ---------------------------------------------------

const amount = z.number().optional();

const cliResultSchema = z.looseObject({
  type: z.literal('result'),
  subtype: z.string().optional(),
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  duration_ms: amount,
  total_cost_usd: amount,
  num_turns: amount,
  session_id: z.string().optional(),
  api_error_status: z.number().nullable().optional(),
  usage: z
    .looseObject({
      input_tokens: amount,
      output_tokens: amount,
      cache_creation_input_tokens: amount,
      cache_read_input_tokens: amount,
      output_tokens_details: z.looseObject({ thinking_tokens: amount }).optional(),
    })
    .optional(),
  modelUsage: z.record(z.string(), z.looseObject({ inputTokens: amount, outputTokens: amount })).optional(),
});

type CliResult = z.infer<typeof cliResultSchema>;

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** With `--output-format json` the CLI prints a `result` object; with `--verbose`, a list of messages. */
function locateResult(value: unknown): { result: Record<string, unknown>; initialModel?: string } | undefined {
  if (isObject(value)) return value.type === 'result' ? { result: value } : undefined;
  if (!Array.isArray(value)) return undefined;
  const result = value.findLast((m): m is Record<string, unknown> => isObject(m) && m.type === 'result');
  if (!result) return undefined;
  const start = value.find((m) => isObject(m) && m.type === 'system' && m.subtype === 'init');
  const initialModel = isObject(start) && typeof start.model === 'string' ? start.model : undefined;
  return initialModel === undefined ? { result } : { result, initialModel };
}

const reported = (value: unknown, field: string): string => (value === undefined ? 'not_reported' : `claude:${field}`);

function usageOf(r: CliResult, measuredDurationMs: number, detailed: boolean): Usage {
  const u = r.usage ?? {};
  const basic: Usage = {
    // Includes input tokens read from or written to the cache.
    inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    outputTokens: u.output_tokens ?? 0,
    durationMs: r.duration_ms ?? measuredDurationMs,
    ...(r.total_cost_usd === undefined ? {} : { declaredCostUsd: r.total_cost_usd }),
  };
  if (!detailed) return basic;
  const thinking = u.output_tokens_details?.thinking_tokens;
  return {
    ...basic,
    ...(u.cache_read_input_tokens === undefined ? {} : { cachedInputTokens: u.cache_read_input_tokens }),
    ...(thinking === undefined ? {} : { reasoningTokens: thinking }),
    ...(r.num_turns === undefined ? {} : { turns: r.num_turns }),
    provenance: {
      inputTokens: reported(u.input_tokens, 'result.usage.input_tokens+cache_*'),
      cachedInputTokens: reported(u.cache_read_input_tokens, 'result.usage.cache_read_input_tokens'),
      outputTokens: reported(u.output_tokens, 'result.usage.output_tokens'),
      reasoningTokens: reported(thinking, 'result.usage.output_tokens_details.thinking_tokens'),
      turns: reported(r.num_turns, 'result.num_turns'),
      durationMs: r.duration_ms === undefined ? 'demiurgo:measured' : 'claude:result.duration_ms',
      declaredCostUsd: reported(r.total_cost_usd, 'result.total_cost_usd'),
    },
  };
}

/** Observed model: whichever one in `modelUsage` generated the most tokens, or the one from the init message. */
function observedModel(r: CliResult, initialModel: string | undefined): string | undefined {
  const usages = Object.entries(r.modelUsage ?? {});
  if (usages.length === 0) return initialModel;
  usages.sort(([, a], [, b]) => (b.outputTokens ?? 0) - (a.outputTokens ?? 0) || (b.inputTokens ?? 0) - (a.inputTokens ?? 0));
  return usages[0]?.[0] ?? initialModel;
}

/** Without structured output, `result` is parsed as JSON if possible; otherwise it's passed through as is. */
function outputFromText(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  const json = parseJson(text.trim());
  return json.ok ? json.value : text;
}

function truncate(text: string, max = 1500): string {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function describeEnd(end: ProcessEnd): string {
  return end.signal ? `by signal ${end.signal}` : `with code ${end.code ?? 'unknown'}`;
}

/** Converts what the CLI printed into an `AgentResult`. Doesn't validate the structured output. */
export function normalizeClaudeOutput(
  end: ProcessEnd,
  requestedModel: string,
  measuredDurationMs: number,
  options: { provider?: string; detailed?: boolean; rawEvents?: string } = {},
): AgentResult {
  const common = { rawEvents: options.rawEvents ?? end.stdout, provider: options.provider ?? CLAUDE_PROVIDER_ID };
  const json = parseJson(end.stdout.trim());
  const located = json.ok ? locateResult(json.value) : undefined;
  const parsed = located ? cliResultSchema.safeParse(located.result) : undefined;
  if (!located || !parsed?.success) {
    const stderr = end.stderr.trim() ? ` Error output: ${truncate(end.stderr)}` : '';
    return {
      state: 'error',
      failureKind: 'agent_error',
      message: `The Claude CLI ended ${describeEnd(end)} without a readable JSON result.${stderr}`,
      model: requestedModel,
      ...common,
    };
  }
  const r = parsed.data;
  const usage = usageOf(r, measuredDurationMs, options.detailed ?? true);
  const model = observedModel(r, located.initialModel) ?? requestedModel;
  if (r.is_error === true || end.code !== 0) {
    const apiState = typeof r.api_error_status === 'number' ? ` (HTTP ${r.api_error_status})` : '';
    const detail = r.result ?? r.subtype ?? (end.stderr.trim() || 'no detail');
    return {
      state: 'error',
      failureKind: 'agent_error',
      message: `The Claude CLI returned an error ${describeEnd(end)}${apiState}: ${truncate(detail)}`,
      usage,
      model,
      ...common,
    };
  }
  const rawOutput = 'structured_output' in located.result ? located.result.structured_output : outputFromText(r.result);
  return { state: 'ok', rawOutput, usage, model, ...common };
}
