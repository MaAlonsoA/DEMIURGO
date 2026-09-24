// Closed JobSpec for the runner broker (docs/investigacion-stack-2026-09-24.md §6).
// It's the only way to request a container: an image pinned by digest from an allowed
// list, a command, stdin input, a max time, limits and a few environment variables.
// Any other option (mounts, network, privileges, user, etc.) is rejected: the schema is
// strict and the security flags are set by the broker, never by whoever requests the job.

import { z } from 'zod';

/** Images the runner may launch, always pinned by digest and already pulled. */
export const ALLOWED_IMAGES: readonly string[] = Object.freeze([
  'node:24.21-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1',
]);

/** Environment variables a job may set inside the container. */
export const ALLOWED_ENV: readonly string[] = Object.freeze(['LANG', 'LC_ALL', 'TZ', 'CI', 'NODE_ENV']);

export const MAX_TIME_MS = 600_000;

export const LIMITS = Object.freeze({
  cpus: { min: 0.1, max: 4, defaultValue: 1 },
  memoryMb: { min: 64, max: 4096, defaultValue: 512 },
  pids: { min: 16, max: 1024, defaultValue: 128 },
});

/** name[:port]/path:tag@sha256:<64 hex>, lowercase as required by the registry. */
const IMAGE_PATTERN =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::\d+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*:[\w][\w.-]{0,127}@sha256:[a-f0-9]{64}$/;

/** Text without NUL: neither docker nor the OS accepts it in arguments. */
const withoutNul = (field: string) =>
  z.string({ error: `${field} must be text.` }).refine((s) => !s.includes('\0'), `${field} cannot contain the NUL character.`);

const image = z
  .string({ error: 'The image must be text.' })
  .regex(IMAGE_PATTERN, {
    error: 'The image must be pinned by digest: name:tag@sha256:<64 lowercase hex characters>.',
    abort: true,
  })
  .refine((v) => ALLOWED_IMAGES.includes(v), {
    error: (iss) => `The image ${String(iss.input)} is not in the runner's list of allowed images.`,
  });

const command = z
  .array(
    withoutNul('Each command argument').pipe(z.string().max(4096, 'Each command argument allows at most 4096 characters.')),
    {
      error: 'The command must be a list of strings.',
    },
  )
  .min(1, { error: 'The command needs at least one element.', abort: true })
  .max(64, 'The command allows at most 64 arguments.')
  .refine((c) => (c[0] ?? '').length > 0, 'The first element of the command cannot be empty.');

const input = withoutNul('The input')
  .pipe(z.string().max(1_000_000, 'The input allows at most 1,000,000 characters.'))
  .optional();

const maxTimeMs = z
  .number({ error: 'maxTimeMs must be a number of milliseconds.' })
  .int('maxTimeMs must be a whole number of milliseconds.')
  .min(1, `maxTimeMs must be between 1 and ${MAX_TIME_MS} ms.`)
  .max(MAX_TIME_MS, `maxTimeMs must be between 1 and ${MAX_TIME_MS} ms.`);

const range = (field: string, r: { min: number; max: number; defaultValue: number }, isInteger: boolean) => {
  const base = z
    .number({ error: `${field} must be a number.` })
    .min(r.min, `${field} must be between ${r.min} and ${r.max}.`)
    .max(r.max, `${field} must be between ${r.min} and ${r.max}.`);
  return (isInteger ? base.int(`${field} must be a whole number.`) : base).default(r.defaultValue);
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
          ? `Unsupported limits: ${iss.keys.join(', ')}. Only cpus, memoryMb and pids are allowed.`
          : 'limits must be an object.',
    },
  )
  .default({ cpus: LIMITS.cpus.defaultValue, memoryMb: LIMITS.memoryMb.defaultValue, pids: LIMITS.pids.defaultValue });

const environment = z
  .record(
    z.string(),
    z
      .string({ error: 'Environment values must be text.' })
      .max(256, 'Environment values allow at most 256 characters.')
      .regex(/^[\x20-\x7e]*$/, 'Environment values only allow printable ASCII characters.'),
    { error: 'environment must be a key-value object.' },
  )
  .superRefine((value, ctx) => {
    const forbidden = Object.keys(value).filter((k) => !ALLOWED_ENV.includes(k));
    if (forbidden.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: `Environment variables not allowed: ${forbidden.join(', ')}. Only ${ALLOWED_ENV.join(', ')} are allowed.`,
      });
    }
  })
  .default({});

export const jobSpecSchema = z.strictObject(
  { image, command, input, maxTimeMs, limits, environment },
  {
    error: (iss) =>
      iss.code === 'unrecognized_keys'
        ? `Unsupported JobSpec options: ${iss.keys.join(', ')}. The broker sets mounts, network, user and privileges.`
        : 'The JobSpec must be an object.',
  },
);

/** Validated JobSpec, with default values applied. */
export type JobSpec = z.output<typeof jobSpecSchema>;
/** JobSpec as requested by whoever commissions the job. */
export type JobSpecInput = z.input<typeof jobSpecSchema>;

export class InvalidJobSpec extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`JobSpec rejected: ${problems.join(' ')}`);
    this.name = 'InvalidJobSpec';
    this.problems = problems;
  }
}

/** Validates a JobSpec and throws `InvalidJobSpec` with the reasons if it fails. */
export function validateJobSpec(specInput: unknown): JobSpec {
  const r = jobSpecSchema.safeParse(specInput);
  if (r.success) return r.data;
  throw new InvalidJobSpec(r.error.issues.map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message)));
}
