// Entorno de los procesos hijos (agentes por CLI): lista permitida, nunca herencia. Junto con
// `config.ts`, es el único módulo que lee variables de entorno (AC-ESQ-001-06), y solo para
// filtrarlas.

/** Variables que la CLI necesita para arrancar en Windows y encontrar la suscripción. */
export const VARIABLES_PERMITIDAS = [
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
export const VARIABLES_FIJAS: Readonly<Record<string, string>> = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
};

/** Nunca llegan a un agente, aunque se pidan como extra: credenciales de BD, de modelo o de DEMIURGO. */
export function esVariableProhibida(nombre: string): boolean {
  const n = nombre.toUpperCase();
  return (
    n.startsWith('DEMIURGO_') ||
    n === 'DATABASE_URL' ||
    n.startsWith('PG') ||
    n === 'ANTHROPIC_API_KEY' ||
    n === 'ANTHROPIC_AUTH_TOKEN'
  );
}

/** El entorno del proceso de DEMIURGO, solo como origen del filtro. */
export function entornoDelProceso(): Readonly<Record<string, string | undefined>> {
  return process.env;
}

/**
 * Construye el entorno del hijo con la lista permitida (sin distinguir mayúsculas, como en
 * Windows) más las variables fijas. `extra` amplía la lista, pero nunca con las prohibidas.
 */
export function entornoPermitido(
  origen: Readonly<Record<string, string | undefined>> = entornoDelProceso(),
  extra: readonly string[] = [],
): Record<string, string> {
  const permitidas = new Set([...VARIABLES_PERMITIDAS, ...extra].map((v) => v.toUpperCase()));
  const env: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(origen)) {
    if (valor === undefined || esVariableProhibida(clave)) continue;
    if (permitidas.has(clave.toUpperCase())) env[clave] = valor;
  }
  return { ...env, ...VARIABLES_FIJAS };
}
