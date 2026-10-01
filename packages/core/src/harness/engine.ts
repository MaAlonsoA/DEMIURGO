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

/**
 * Normalises the cohort keys of one set of marks (convención nuestra, on the practice of not mixing engine versions that
 * really differ: Kohavi, Tang and Xu, «Trustworthy Online Controlled Experiments»): the same machine marked in several
 * ways is one cohort.
 * - an alias with no reported model (`sonnet`) reads as the model that every mark of the same provider and alias that did
 *   report one reported, when they all reported the same; two different reported models leave the alias apart;
 * - a mark with no CLI version (`?`) joins the single known version of its provider and model; with two or more known
 *   versions it stays apart as `?` (the version was not recorded).
 * Returns the function that gives the normalised key of a mark. Pure.
 */
export function cohortNormalizer(marks: readonly Partial<EngineMark>[]): (mark: Partial<EngineMark> | null | undefined) => string {
  const reportedOf = new Map<string, Set<string>>();
  for (const m of marks) {
    const provider = text(m.provider);
    const requested = text(m.model);
    const reported = text(m.model_reported);
    if (!provider || !requested || !reported || text(m.jev_model)) continue;
    const k = `${provider}|${requested}`;
    reportedOf.set(k, (reportedOf.get(k) ?? new Set()).add(reported));
  }
  const modelOf = (m: Partial<EngineMark>): string | null => {
    const provider = text(m.provider);
    const requested = text(m.model);
    const explicit = text(m.jev_model) ?? text(m.model_reported);
    if (explicit) return explicit;
    if (!provider || !requested) return null;
    const seen = reportedOf.get(`${provider}|${requested}`);
    return seen && seen.size === 1 ? [...seen][0]! : requested;
  };
  const versions = new Map<string, Set<string>>();
  for (const m of marks) {
    const provider = text(m.provider);
    const model = modelOf(m);
    const v = majorMinor(text(m.cli_version));
    if (!provider || !model || !v) continue;
    const k = `${provider}|${model}`;
    versions.set(k, (versions.get(k) ?? new Set()).add(v));
  }
  return (mark) => {
    if (!mark || typeof mark !== 'object') return UNKNOWN_COHORT;
    const provider = text(mark.provider);
    const model = modelOf(mark);
    if (!provider || !model) return UNKNOWN_COHORT;
    let v = majorMinor(text(mark.cli_version));
    if (!v) {
      const known = versions.get(`${provider}|${model}`);
      v = known && known.size === 1 ? [...known][0]! : null;
    }
    return `${provider}|${model}|${v ?? '?'}`;
  };
}

/** A readable name of a cohort key: `claude · claude-sonnet-5-5 · CLI 2.1` (`CLI version not recorded` for `?`). */
export function cohortLabel(key: string): string {
  if (key === UNKNOWN_COHORT) return 'unknown engine';
  const [provider, model, version] = key.split('|');
  return [provider, model, version === undefined || version === '?' ? 'CLI version not recorded' : `CLI ${version}`].filter(Boolean).join(' · ');
}

/** A row that can say which cohort it belongs to. `engine_at`, `class` and `build_request_id` sharpen the choice of the current one. */
export type CohortRow = { piece: string; finding?: string | null; engine_cohort: string; engine_at?: string | null; class?: string; build_request_id?: string };

/** The unit a cohort is cut for: one rule of one piece (a rule that reads no engine keeps all its rows). */
export const cohortUnitOf = (r: CohortRow): string => `${r.piece}/${r.finding ?? ''}`;

/** A cohort needs at least this many decisions (TP, FP, FN, TN) or this many requests to be the current one (convención nuestra). */
export const CURRENT_MIN_DECISIONS = 10;
export const CURRENT_MIN_REQUESTS = 3;

const DECISION_CLASSES = new Set(['tp', 'fp', 'fn', 'tn']);

export type CohortStat = { cohort: string; rows: number; decisions: number; requests: number; engine_at: string | null };

export type CohortSelection<T> = {
  rows: T[];
  /** The cohort each rule (`piece/finding`) was cut to (absent for a rule with no known cohort: it keeps all its rows). */
  applied: Record<string, string>;
  /** Rows per cohort before the cut, whatever they belong to. */
  available: Record<string, number>;
  /** Rows left out by the cut. */
  excluded: number;
  /** Rows left out by the cut, per piece. */
  excluded_by_piece: Record<string, number>;
  /** Per rule where the newest cohort was not applied (it had too little evidence): the newest one and its size. */
  newer_skipped: Record<string, CohortStat>;
};

const time = (r: CohortRow): number => (r.engine_at ? new Date(r.engine_at).getTime() : Number.NEGATIVE_INFINITY);

/**
 * Cuts the rows to one engine cohort so that engines of different versions are not mixed. `requested`: `all` keeps
 * every row (the caller asked to mix); a cohort key keeps that cohort; omitted or `current` keeps, per rule, the newest
 * cohort BY ENGINE TIME (`engine_at`, when the engine ran, not when the post-mortem was computed; the order of the rows
 * breaks ties and stands in when there is none) that has at least 10 decisions or 3 requests, else the newest one. A rule
 * with no known cohort keeps everything, so data from before the marks existed is not hidden. Pure.
 */
export function selectEngineCohort<T extends CohortRow>(rows: readonly T[], requested?: string): CohortSelection<T> {
  const available: Record<string, number> = {};
  for (const r of rows) available[r.engine_cohort] = (available[r.engine_cohort] ?? 0) + 1;
  const result = (kept: T[], applied: Record<string, string>, newer_skipped: Record<string, CohortStat> = {}): CohortSelection<T> => {
    const excluded_by_piece: Record<string, number> = {};
    const keptSet = new Set(kept);
    for (const r of rows) if (!keptSet.has(r)) excluded_by_piece[r.piece] = (excluded_by_piece[r.piece] ?? 0) + 1;
    return { rows: kept, applied, available, excluded: rows.length - kept.length, excluded_by_piece, newer_skipped };
  };
  if (requested === 'all') return result([...rows], {});
  if (requested && requested !== 'current') {
    const kept = rows.filter((r) => r.engine_cohort === requested);
    const applied: Record<string, string> = {};
    for (const r of kept) applied[cohortUnitOf(r)] = requested;
    return result(kept, applied);
  }
  const stats = new Map<string, Map<string, CohortStat & { order: number; at: number; reqs: Set<string> }>>();
  rows.forEach((r, index) => {
    if (r.engine_cohort === UNKNOWN_COHORT) return;
    const unit = cohortUnitOf(r);
    const byCohort = stats.get(unit) ?? new Map();
    stats.set(unit, byCohort);
    const s = byCohort.get(r.engine_cohort) ?? { cohort: r.engine_cohort, rows: 0, decisions: 0, requests: 0, engine_at: null, order: index, at: Number.NEGATIVE_INFINITY, reqs: new Set<string>() };
    s.rows += 1;
    if (r.class !== undefined && DECISION_CLASSES.has(r.class)) s.decisions += 1;
    if (r.build_request_id) s.reqs.add(r.build_request_id);
    s.requests = s.reqs.size;
    if (time(r) > s.at) {
      s.at = time(r);
      s.engine_at = r.engine_at ?? null;
    }
    byCohort.set(r.engine_cohort, s);
  });
  const applied: Record<string, string> = {};
  const newer_skipped: Record<string, CohortStat> = {};
  for (const [unit, byCohort] of stats) {
    // Newest by engine time; the cohort that appears first in the (newest first) rows wins a tie or a missing time.
    const ordered = [...byCohort.values()].sort((a, b) => (a.at === b.at ? 0 : b.at > a.at ? 1 : -1) || a.order - b.order);
    const enough = ordered.find((s) => s.decisions >= CURRENT_MIN_DECISIONS || s.requests >= CURRENT_MIN_REQUESTS) ?? ordered[0]!;
    applied[unit] = enough.cohort;
    const newest = ordered[0]!;
    if (newest.cohort !== enough.cohort) newer_skipped[unit] = { cohort: newest.cohort, rows: newest.rows, decisions: newest.decisions, requests: newest.requests, engine_at: newest.engine_at };
  }
  const kept = rows.filter((r) => applied[cohortUnitOf(r)] === undefined || r.engine_cohort === applied[cohortUnitOf(r)]);
  return result(kept, applied, newer_skipped);
}
