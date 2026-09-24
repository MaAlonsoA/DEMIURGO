// JobSpec cerrado del broker del runner (docs/investigacion-stack-2026-09-24.md §6).
// Es la única forma de pedir un contenedor: imagen por digest de una lista permitida,
// comando, entrada por stdin, tiempo máximo, límites y unas pocas variables de entorno.
// Cualquier otra opción (montajes, red, privilegios, usuario, etc.) se rechaza: el esquema
// es estricto y los flags de seguridad los fija el broker, nunca quien pide el trabajo.

import { z } from 'zod';

/** Imágenes que el runner puede lanzar, siempre fijadas por digest y ya descargadas. */
export const ALLOWED_IMAGES: readonly string[] = Object.freeze([
  'node:24.21-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1',
]);

/** Variables de entorno que un trabajo puede fijar dentro del contenedor. */
export const ALLOWED_ENV: readonly string[] = Object.freeze(['LANG', 'LC_ALL', 'TZ', 'CI', 'NODE_ENV']);

export const MAX_TIME_MS = 600_000;

export const LIMITS = Object.freeze({
  cpus: { min: 0.1, max: 4, defaultValue: 1 },
  memoryMb: { min: 64, max: 4096, defaultValue: 512 },
  pids: { min: 16, max: 1024, defaultValue: 128 },
});

/** nombre[:puerto]/ruta:tag@sha256:<64 hex>, en minúsculas como exige el registro. */
const IMAGE_PATTERN =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::\d+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*:[\w][\w.-]{0,127}@sha256:[a-f0-9]{64}$/;

/** Texto sin NUL: ni docker ni el sistema operativo lo admiten en argumentos. */
const withoutNul = (field: string) =>
  z
    .string({ error: `${field} debe ser un texto.` })
    .refine((s) => !s.includes('\0'), `${field} no puede contener el carácter NUL.`);

const image = z
  .string({ error: 'La imagen debe ser un texto.' })
  .regex(IMAGE_PATTERN, {
    error: 'La imagen debe ir fijada por digest: nombre:tag@sha256:<64 hexadecimales en minúscula>.',
    abort: true,
  })
  .refine((v) => ALLOWED_IMAGES.includes(v), {
    error: (iss) => `La imagen ${String(iss.input)} no está en la lista de imágenes permitidas del runner.`,
  });

const command = z
  .array(
    withoutNul('Cada argumento del comando').pipe(
      z.string().max(4096, 'Cada argumento del comando admite 4096 caracteres como máximo.'),
    ),
    {
      error: 'El comando debe ser una lista de textos.',
    },
  )
  .min(1, { error: 'El comando necesita al menos un elemento.', abort: true })
  .max(64, 'El comando admite 64 argumentos como máximo.')
  .refine((c) => (c[0] ?? '').length > 0, 'El primer elemento del comando no puede estar vacío.');

const input = withoutNul('La entrada')
  .pipe(z.string().max(1_000_000, 'La entrada admite 1 000 000 caracteres como máximo.'))
  .optional();

const maxTimeMs = z
  .number({ error: 'tiempoMaxMs debe ser un número de milisegundos.' })
  .int('tiempoMaxMs debe ser un número entero de milisegundos.')
  .min(1, `tiempoMaxMs debe estar entre 1 y ${MAX_TIME_MS} ms.`)
  .max(MAX_TIME_MS, `tiempoMaxMs debe estar entre 1 y ${MAX_TIME_MS} ms.`);

const range = (field: string, r: { min: number; max: number; defaultValue: number }, isInteger: boolean) => {
  const base = z
    .number({ error: `${field} debe ser un número.` })
    .min(r.min, `${field} debe estar entre ${r.min} y ${r.max}.`)
    .max(r.max, `${field} debe estar entre ${r.min} y ${r.max}.`);
  return (isInteger ? base.int(`${field} debe ser un número entero.`) : base).default(r.defaultValue);
};

const limits = z
  .strictObject(
    {
      cpus: range('limits.cpus', LIMITS.cpus, false),
      memoryMb: range('limits.memoryMb', LIMITS.memoryMb, true),
      pids: range('limits.pids', LIMITS.pids, true),
    },
    {
      error: (iss) =>
        iss.code === 'unrecognized_keys'
          ? `Límites no admitidos: ${iss.keys.join(', ')}. Solo se admiten cpus, memoriaMb y pids.`
          : 'limites debe ser un objeto.',
    },
  )
  .default({ cpus: LIMITS.cpus.defaultValue, memoryMb: LIMITS.memoryMb.defaultValue, pids: LIMITS.pids.defaultValue });

const environment = z
  .record(
    z.string(),
    z
      .string({ error: 'Los valores del entorno deben ser textos.' })
      .max(256, 'Los valores del entorno admiten 256 caracteres como máximo.')
      .regex(/^[\x20-\x7e]*$/, 'Los valores del entorno solo admiten caracteres ASCII imprimibles.'),
    { error: 'entorno debe ser un objeto de clave y valor.' },
  )
  .superRefine((value, ctx) => {
    const forbidden = Object.keys(value).filter((k) => !ALLOWED_ENV.includes(k));
    if (forbidden.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: `Variables de entorno no permitidas: ${forbidden.join(', ')}. Solo se admiten ${ALLOWED_ENV.join(', ')}.`,
      });
    }
  })
  .default({});

export const jobSpecSchema = z.strictObject(
  { image, command, input, maxTimeMs, limits, environment },
  {
    error: (iss) =>
      iss.code === 'unrecognized_keys'
        ? `Opciones no admitidas en el JobSpec: ${iss.keys.join(', ')}. El broker fija montajes, red, usuario y privilegios.`
        : 'El JobSpec debe ser un objeto.',
  },
);

/** JobSpec validado, con los valores por defecto aplicados. */
export type JobSpec = z.output<typeof jobSpecSchema>;
/** JobSpec tal como lo pide quien encarga el trabajo. */
export type JobSpecInput = z.input<typeof jobSpecSchema>;

export class InvalidJobSpec extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`JobSpec rechazado: ${problems.join(' ')}`);
    this.name = 'InvalidJobSpec';
    this.problems = problems;
  }
}

/** Valida un JobSpec y lanza `JobSpecInvalido` con los motivos en español si no cumple. */
export function validateJobSpec(specInput: unknown): JobSpec {
  const r = jobSpecSchema.safeParse(specInput);
  if (r.success) return r.data;
  throw new InvalidJobSpec(r.error.issues.map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message)));
}
