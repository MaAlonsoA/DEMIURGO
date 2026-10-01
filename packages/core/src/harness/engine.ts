// The engine marks (salud-del-harness §9.3): which engine answered a call, so that results of different engine versions
// are never mixed silently. `harness_versions` marks DEMIURGO's own pieces; this marks what DEMIURGO does not control:
// the provider and model of each agent, the version of the CLI that ran it and the model Jev answered with. A cohort is
// observational (the engine changes under us, not by assignment). Pure parts first, then the CLI version lookup.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export type EngineMark = {
  /** `claude`, `codex`, `opencode`, `simulated` or `jev`. */
  provider: string;
  /** The model asked for (an alias such as `sonnet` may point to different models over time). */
  model: string;
  /** The model the provider's stream or response says it used, when it says one. */
  model_reported?: string | null;
  /** Version of the CLI that ran the call (`claude --version`, `codex --version`), when there is a CLI and it said. */
  cli_version?: string | null;
  /** Jev only: the TypeSafe model id that answered. */
  jev_model?: string | null;
};

export const UNKNOWN_COHORT = 'unknown';

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** The first dotted version in a CLI's `--version` output (`2.1.4 (Claude Code)`, `codex-cli 0.46.0`), or null. */
export function parseCliVersion(output: string): string | null {
  return /(\d+\.\d+\.\d+[0-9A-Za-z.+-]*)/.exec(output)?.[1] ?? null;
}

/** `major.minor` of a version: a patch release is the same cohort (convención nuestra), a minor one is not. */
export function majorMinor(version: string | null | undefined): string | null {
  const m = /(\d+)\.(\d+)/.exec(version ?? '');
  return m ? `${m[1]}.${m[2]}` : null;
}

/**
 * The cohort of an engine mark: `provider|model|cli major.minor`. The model is the reported one when the provider said
 * it (aliases move), else the requested one; Jev's is its answered model id. A part that is not known is `?`, and a mark
 * with no provider or model has no cohort (`unknown`: data from before the marks existed). Two marks of the same
 * cohort are comparable; two of different cohorts are not.
 */
export function engineCohortKey(engine: Partial<EngineMark> | null | undefined): string {
  if (!engine || typeof engine !== 'object') return UNKNOWN_COHORT;
  const provider = text(engine.provider);
  const model = text(engine.jev_model) ?? text(engine.model_reported) ?? text(engine.model);
  if (!provider || !model) return UNKNOWN_COHORT;
  return `${provider}|${model}|${majorMinor(text(engine.cli_version)) ?? '?'}`;
}

/** Reads a stored mark (a JSON string or an object) into a mark, or null when it is not one. */
export function engineMarkOf(value: unknown): EngineMark | null {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const provider = text(o.provider);
  const model = text(o.model) ?? text(o.jev_model);
  if (!provider || !model) return null;
  return { provider, model, model_reported: text(o.model_reported), cli_version: text(o.cli_version), jev_model: text(o.jev_model) };
}

/** The mark of a call: what was asked, what the provider reported and the CLI version. Pure. */
export function buildEngineMark(input: { provider: string; model: string; modelReported?: string | null; cliVersion?: string | null; jevModel?: string | null }): EngineMark {
  const reported = text(input.modelReported);
  return {
    provider: input.provider,
    model: input.model,
    model_reported: reported,
    cli_version: text(input.cliVersion),
    ...(input.jevModel !== undefined ? { jev_model: text(input.jevModel) } : {}),
  };
}

// ------------------------------------------------------------------------------------------------ the CLI version

const CLI_BINARIES: Record<string, string> = { claude: 'claude', codex: 'codex' };
const versionOfBinary = new Map<string, Promise<string | null>>();

/**
 * The version of a provider's CLI as `<cli> --version` says, asked once per process and binary (the binary does not
 * change under a running process). The API runs the same CLIs it discovers engines with; the builder containers run the
 * image's own, so for Claude the stream's `init` event (`claude_code_version`) is preferred where there is one. A provider
 * without a CLI (OpenCode talks to an endpoint, Jev to an API) and a failure give null: marking never stops the work.
 */
export function cliVersionOf(provider: string, run: (binary: string) => Promise<string> = defaultRun): Promise<string | null> {
  const binary = CLI_BINARIES[provider];
  if (!binary) return Promise.resolve(null);
  let known = versionOfBinary.get(binary);
  if (!known) {
    known = run(binary).then(parseCliVersion, () => null);
    versionOfBinary.set(binary, known);
  }
  return known;
}

async function defaultRun(binary: string): Promise<string> {
  const { stdout } = await promisify(execFile)(binary, ['--version'], { timeout: 5000 });
  return stdout;
}

/** Tests only. */
export function resetCliVersionCache(): void {
  versionOfBinary.clear();
}

// ------------------------------------------------------------------------------------------------ cohort selection

/** A row that can say which cohort it belongs to. */
export type CohortRow = { piece: string; finding?: string | null; engine_cohort: string };

/** The unit a cohort is cut for: one rule of one piece (a rule that reads no engine keeps all its rows). */
export const cohortUnitOf = (r: CohortRow): string => `${r.piece}/${r.finding ?? ''}`;

export type CohortSelection<T> = {
  rows: T[];
  /** The cohort each rule (`piece/finding`) was cut to (absent for a rule with no known cohort: it keeps all its rows). */
  applied: Record<string, string>;
  /** Rows per cohort before the cut, whatever they belong to. */
  available: Record<string, number>;
  /** Rows left out by the cut. */
  excluded: number;
};

/**
 * Cuts the rows to one engine cohort so that engines of different versions are not mixed. `requested`: `all` keeps
 * every row (the caller asked to mix); a cohort key keeps that cohort; omitted or `current` keeps, per rule, the cohort of
 * its newest row with a known cohort (the rows come newest first). A rule with no known cohort keeps everything, so
 * data from before the marks existed is not hidden. Pure.
 */
export function selectEngineCohort<T extends CohortRow>(rows: readonly T[], requested?: string): CohortSelection<T> {
  const available: Record<string, number> = {};
  for (const r of rows) available[r.engine_cohort] = (available[r.engine_cohort] ?? 0) + 1;
  if (requested === 'all') return { rows: [...rows], applied: {}, available, excluded: 0 };
  const applied: Record<string, string> = {};
  if (requested && requested !== 'current') {
    const kept = rows.filter((r) => r.engine_cohort === requested);
    for (const r of kept) applied[cohortUnitOf(r)] = requested;
    return { rows: kept, applied, available, excluded: rows.length - kept.length };
  }
  for (const r of rows) if (r.engine_cohort !== UNKNOWN_COHORT && applied[cohortUnitOf(r)] === undefined) applied[cohortUnitOf(r)] = r.engine_cohort;
  const kept = rows.filter((r) => applied[cohortUnitOf(r)] === undefined || r.engine_cohort === applied[cohortUnitOf(r)]);
  return { rows: kept, applied, available, excluded: rows.length - kept.length };
}
