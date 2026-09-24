// Entorno de los procesos hijos (agentes por CLI): lista permitida, nunca herencia. Junto con
// `config.ts`, es el único módulo que lee variables de entorno (AC-ESQ-001-06), y solo para
// filtrarlas.

/** Variables que la CLI necesita para arrancar en Windows y encontrar la suscripción. */
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
  // Si la configuración de Claude Code no está en `~/.claude`, las credenciales de la
  // suscripción están donde diga esta variable.
  'CLAUDE_CONFIG_DIR',
] as const;

/** Variables fijas que se añaden: sin telemetría, informes de error ni autoactualización. */
export const FIXED_VARIABLES: Readonly<Record<string, string>> = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
};

/** Nunca llegan a un agente, aunque se pidan como extra: credenciales de BD, de modelo o de DEMIURGO. */
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

/** El entorno del proceso de DEMIURGO, solo como origen del filtro. */
export function processEnv(): Readonly<Record<string, string | undefined>> {
  return process.env;
}

/**
 * Construye el entorno del hijo con la lista permitida (sin distinguir mayúsculas, como en
 * Windows) más las variables fijas. `extra` amplía la lista, pero nunca con las prohibidas.
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
