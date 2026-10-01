// Why a builder run failed, in a short form the person can read: a closed kind and a redacted excerpt of what
// the CLI printed last. Both are stored in the failed `builder` step (build_steps.detail), so nobody has to dig
// through containers to learn why a build stopped.

import { isQuotaError } from '@demiurgo/domain';

export const BUILD_FAILURE_KINDS = ['usage_limit', 'login', 'timeout', 'out_of_memory', 'cancelled', 'infra', 'tdd_red', 'other'] as const;
export type BuildFailureKind = (typeof BUILD_FAILURE_KINDS)[number];

/** The excerpt kept in the step: the last characters of what the builder printed (our convention). */
export const EXCERPT_LENGTH = 1500;

const LIMIT_WORDS = /limit reached|reached (?:your|the) (?:usage )?limit|hit your limit/i;
const LOGIN_WORDS =
  /not logged in|please run \/login|invalid api key|invalid[ _-]?(?:x-api-key|credentials)|authentication[ _-]?(?:error|failed|required)|failed to authenticate|failed to refresh oauth token|oauth session expired|oauth token (?:has )?expired|credentials? (?:have )?expired|access token could not be refreshed|refresh token was already used|log out and sign in again|unauthori[sz]ed|\b401\b/i;
const OOM_WORDS = /out of memory|\bOOM\b|cannot allocate memory|heap out of memory|JavaScript heap|\bkilled\b/i;
const TIMEOUT_WORDS = /timed out|timeout|ETIMEDOUT/i;

/** Transient: waiting makes it work again without anybody changing anything. */
export const isTransientFailure = (kind: string | null | undefined): boolean => kind === 'usage_limit';

/**
 * The Claude CLI's stream-json prints a `rate_limit_event` line even in a healthy run; only a rejected
 * one says something. Lines of that event that were not rejected are dropped before looking for words.
 */
function meaningful(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.includes('rate_limit_event') || /rejected|exceeded|blocked/i.test(line))
    .join('\n');
}

/**
 * Classifies a failed builder run. `runnerKind` is what the runner knows (timeout, cancelled, infra); the
 * rest comes from the exit code and the words in stderr and the end of the transcript.
 */
export function classifyBuilderFailure(input: {
  runnerKind?: string | null;
  exitCode: number | null;
  stderr?: string;
  transcript?: string;
}): BuildFailureKind {
  if (input.runnerKind === 'cancelled') return 'cancelled';
  if (input.runnerKind === 'timeout') return 'timeout';
  if (input.runnerKind === 'login') return 'login';
  const text = meaningful(`${input.stderr ?? ''}\n${(input.transcript ?? '').slice(-6000)}`);
  // The quota and auth words win over the exit code: they say why the CLI exited.
  if (isQuotaError(text) || LIMIT_WORDS.test(text)) return 'usage_limit';
  if (LOGIN_WORDS.test(text)) return 'login';
  if (input.exitCode === 137 || OOM_WORDS.test(input.stderr ?? '')) return 'out_of_memory';
  if (input.runnerKind === 'infra') return 'infra';
  if (TIMEOUT_WORDS.test(input.stderr ?? '')) return 'timeout';
  return 'other';
}

const SECRET_PATTERNS: RegExp[] = [
  /\bgithub_pat_[A-Za-z0-9_]{10,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{10,}/g,
  /\bsk-[A-Za-z0-9_-]{10,}/g,
  /\bdmg_agent_[A-Za-z0-9_-]{6,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:Authorization|x-api-key)\s*[:=]\s*\S+/gi,
];

/** Environment values that are secrets by their name (DEMIURGO_GITHUB_TOKEN, API keys, passwords…). */
function secretValues(env: Readonly<Record<string, string | undefined>>): string[] {
  return Object.entries(env)
    .filter(([name, value]) => /TOKEN|SECRET|PASSWORD|API_?KEY|CREDENTIAL/i.test(name) && typeof value === 'string' && value.trim().length >= 8)
    .map(([, value]) => (value as string).trim());
}

/** The text with tokens and secret environment values replaced by `***`. */
export function redactSecrets(text: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  let out = text;
  for (const value of secretValues(env).sort((a, b) => b.length - a.length)) out = out.split(value).join('***');
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, (m) => (/^(?:authorization|x-api-key)/i.test(m) ? `${m.split(/[:=]/)[0]}: ***` : '***'));
  return out;
}

/** The last characters of the builder's output (stderr first when there is any), redacted. */
export function failureExcerpt(
  input: { stderr?: string; transcript?: string },
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const parts = [meaningful(input.transcript ?? '').trim(), (input.stderr ?? '').trim()].filter((p) => p !== '');
  return redactSecrets(parts.join('\n').slice(-EXCERPT_LENGTH), env).trim();
}

/**
 * Why a stage other than the builder failed, for the Build screen: a kind the interface words in plain
 * language (`unreadable_files` for a commit that git could not read, `stage` otherwise) and the last
 * characters of the recorded error, redacted.
 */
export function stageFailure(stage: string, error: string | null | undefined, env: Readonly<Record<string, string | undefined>> = process.env): { kind: string; excerpt: string | null } {
  const text = (error ?? '').trim();
  const unreadable = stage === 'commit' && /unable to (?:stat|open|read)|permission denied|insufficient permission/i.test(text);
  return { kind: unreadable ? 'unreadable_files' : 'stage', excerpt: text === '' ? null : redactSecrets(text.slice(-EXCERPT_LENGTH), env).trim() };
}
