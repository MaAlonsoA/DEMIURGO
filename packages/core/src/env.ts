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
] as const;

/** Fixed variables that get added: no telemetry, error reports or auto-update. */
export const FIXED_VARIABLES: Readonly<Record<string, string>> = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
};

/** Never reach an agent, even if requested as extra: DB, model or DEMIURGO credentials. */
export function isForbiddenVariable(name: string): boolean {
  const n = name.toUpperCase();
  return (
    n.startsWith('DEMIURGO_') ||
    n === 'DATABASE_URL' ||
    n.startsWith('PG') ||
    n === 'ANTHROPIC_API_KEY' ||
    n === 'ANTHROPIC_AUTH_TOKEN'
  );
}

/** The DEMIURGO process's environment, only as the filter's source. */
export function processEnv(): Readonly<Record<string, string | undefined>> {
  return process.env;
}

/**
 * Builds the child's environment with the allow-list (case-insensitive, as on Windows) plus
 * the fixed variables. `extra` widens the list, but never with the forbidden ones.
 */
export function allowedEnv(
  origin: Readonly<Record<string, string | undefined>> = processEnv(),
  extra: readonly string[] = [],
): Record<string, string> {
  const allowed = new Set([...ALLOWED_VARIABLES, ...extra].map((v) => v.toUpperCase()));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(origin)) {
    if (value === undefined || isForbiddenVariable(key)) continue;
    if (allowed.has(key.toUpperCase())) env[key] = value;
  }
  return { ...env, ...FIXED_VARIABLES };
}
