// Environment for child processes (CLI agents): allow-list, never inheritance. Along with
// `config.ts`, it is the only module that reads environment variables (AC-ESQ-001-06), and only
// to filter them.

/** Variables the CLI needs to start on Windows and find the subscription. */
export const ALLOWED_VARIABLES = [
  'PATH',
  'SystemRoot',
  'windir',
  'USERPROFILE',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'TEMP',
  'TMP',
  'LANG',
  // If the Claude Code configuration is not in `~/.claude`, the subscription credentials
  // are wherever this variable points.
  'CLAUDE_CONFIG_DIR',
  // Where Codex keeps its ChatGPT sign-in (defaults to `~/.codex`).
  'CODEX_HOME',
] as const;

/** Fixed variables that get added: no telemetry, error reports or auto-update. */
export const FIXED_VARIABLES: Readonly<Record<string, string>> = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
};

/**
 * Never reach an agent from the parent, even if requested as extra: DB, model or DEMIURGO
 * credentials, and the parent's own telemetry (`OTEL_*`, `TRACEPARENT`): what a CLI exports is
 * decided per call, in `fixed`, never inherited. API keys are excluded so every CLI uses the
 * person's subscription.
 */
export function isForbiddenVariable(name: string): boolean {
  const n = name.toUpperCase();
  return (
    n.startsWith('DEMIURGO_') ||
    n === 'DATABASE_URL' ||
    n.startsWith('PG') ||
    n === 'ANTHROPIC_API_KEY' ||
    n === 'ANTHROPIC_AUTH_TOKEN' ||
    n.startsWith('OPENAI_') ||
    n === 'CODEX_API_KEY' ||
    n.startsWith('OTEL_') ||
    n === 'TRACEPARENT' ||
    n === 'TRACESTATE'
  );
}

/**
 * `OTEL_RESOURCE_ATTRIBUTES` as the OpenTelemetry SDKs read it: `key=value` pairs joined by commas,
 * the values percent-encoded (W3C baggage) so a comma or an equals sign inside one never splits it.
 */
export function otelResourceAttributes(attributes: Readonly<Record<string, string>>): string {
  return Object.entries(attributes)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join(',');
}

/** The DEMIURGO process's environment, only as the filter's source. */
export function processEnv(): Readonly<Record<string, string | undefined>> {
  return process.env;
}

/**
 * Builds the child's environment with the allow-list (case-insensitive, as on Windows) plus
 * the fixed variables. `extra` widens the list, but never with the forbidden ones. `fixed` are
 * variables computed for this call (the telemetry of §7.6): merged last, as they are.
 */
export function allowedEnv(
  origin: Readonly<Record<string, string | undefined>> = processEnv(),
  extra: readonly string[] = [],
  fixed: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const allowed = new Set([...ALLOWED_VARIABLES, ...extra].map((v) => v.toUpperCase()));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(origin)) {
    if (value === undefined || isForbiddenVariable(key)) continue;
    if (allowed.has(key.toUpperCase())) env[key] = value;
  }
  return { ...env, ...FIXED_VARIABLES, ...fixed };
}
