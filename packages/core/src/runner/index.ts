// Runner aislado: JobSpec cerrado, broker (único módulo que invoca docker) y sonda de aislamiento.

export {
  ENTORNO_PERMITIDO,
  esquemaJobSpec,
  IMAGENES_PERMITIDAS,
  type JobSpec,
  type JobSpecEntrada,
  JobSpecInvalido,
  LIMITES,
  TIEMPO_MAX_MS,
  validarJobSpec,
} from './jobspec.ts';
export {
  argumentosDocker,
  ENTORNO_CLI_DOCKER,
  ETIQUETA_RUNNER,
  ejecutarTrabajo,
  entornoDocker,
  type FalloRunner,
  type OpcionesTrabajo,
  type ResultadoTrabajo,
  TMPFS_RUNNER,
  USUARIO_RUNNER,
} from './runner.ts';
export {
  CONFIGURACION_SONDA,
  type ConfiguracionSonda,
  type DestinoTcp,
  ejecutarSonda,
  esquemaInformeSonda,
  generarScriptSonda,
  type InformeSonda,
  PATRON_VARIABLE_SENSIBLE,
  type ResultadoSonda,
  SCRIPT_SONDA,
  specSonda,
  violacionesSonda,
} from './sonda.ts';
