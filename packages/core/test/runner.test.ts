// Runner aislado y sonda (invariante I9). Las pruebas de docker usan la imagen permitida
// por digest; si no está descargada, la preparación la descarga una vez (el broker nunca
// descarga: lanza con `--pull never`).

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dockerArguments,
  ALLOWED_ENV,
  runProbe,
  runJob,
  dockerEnv,
  probeReportSchema,
  generateProbeScript,
  ALLOWED_IMAGES,
  type JobSpecInput,
  InvalidJobSpec,
  validateJobSpec,
  probeViolations,
} from '../src/runner/index.ts';

const IMAGE = ALLOWED_IMAGES[0] ?? '';
const SPEC_BASE: JobSpecInput = { image: IMAGE, command: ['node', '-e', '0'], maxTimeMs: 10_000 };

/** Flags de docker que el broker puede emitir: con valor y sin valor. */
const FLAGS_WITH_VALUE = new Set([
  '--name',
  '--label',
  '--pull',
  '--network',
  '--tmpfs',
  '--cap-drop',
  '--security-opt',
  '--user',
  '--pids-limit',
  '--memory',
  '--memory-swap',
  '--cpus',
  '--env',
]);
const FLAGS_WITHOUT_VALUE = new Set(['--rm', '--read-only', '-i']);

/** Separa los argumentos de `docker run` en pares flag → valor hasta la imagen. */
function analyze(args: string[]): { flags: [string, string | true][]; image: string; command: string[] } {
  expect(args[0]).toBe('run');
  const flags: [string, string | true][] = [];
  let i = 1;
  while (i < args.length) {
    const a = args[i] ?? '';
    if (FLAGS_WITHOUT_VALUE.has(a)) {
      flags.push([a, true]);
      i += 1;
    } else if (FLAGS_WITH_VALUE.has(a)) {
      flags.push([a, args[i + 1] ?? '']);
      i += 2;
    } else {
      break;
    }
  }
  return { flags, image: args[i] ?? '', command: args.slice(i + 1) };
}

/** Mensaje de rechazo de un spec, o `aceptado` si el esquema lo admite. */
function rejectionOf(spec: unknown): string {
  try {
    validateJobSpec(spec);
    return 'accepted';
  } catch (e) {
    return e instanceof InvalidJobSpec ? e.message : `error inesperado: ${String(e)}`;
  }
}

const values = (flags: [string, string | true][], flag: string) => flags.filter(([f]) => f === flag).map(([, v]) => v);

function containerExists(name: string): boolean {
  const output = execFileSync('docker', ['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'], {
    encoding: 'utf8',
  });
  return output.trim().length > 0;
}

function isPortOpen(host: string, port: number, ms = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ host, port: port });
    const end = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(ms, () => end(false));
    s.once('connect', () => end(true));
    s.once('error', () => end(false));
  });
}

describe('JobSpec cerrado y argumentos de docker', () => {
  it('AC-ESQ-001-12 el esquema rechaza imagen sin digest, fuera de la lista, claves extra, entorno no permitido y tiempos fuera de rango', () => {
    const rejections: [unknown, RegExp][] = [
      [{ ...SPEC_BASE, image: 'node:24.21-alpine' }, /fijada por digest/],
      [{ ...SPEC_BASE, image: 'node:latest' }, /fijada por digest/],
      [{ ...SPEC_BASE, image: `node:24.21-alpine@sha256:${'0'.repeat(64)}` }, /no está en la lista de imágenes permitidas/],
      [{ ...SPEC_BASE, image: `alpine:3.22@sha256:${'a'.repeat(64)}` }, /no está en la lista de imágenes permitidas/],
      [{ ...SPEC_BASE, mounts: ['/:/host'] }, /Opciones no admitidas en el JobSpec: montajes/],
      [{ ...SPEC_BASE, network: 'host' }, /Opciones no admitidas en el JobSpec: red/],
      [{ ...SPEC_BASE, privileged: true }, /Opciones no admitidas en el JobSpec: privilegiado/],
      [{ ...SPEC_BASE, username: 'root' }, /Opciones no admitidas en el JobSpec: usuario/],
      [{ ...SPEC_BASE, limits: { cpus: 1, privileged: true } }, /Límites no admitidos: privilegiado/],
      [{ ...SPEC_BASE, environment: { DATABASE_URL: 'postgres://x' } }, /Variables de entorno no permitidas: DATABASE_URL/],
      [{ ...SPEC_BASE, environment: { LANG: 'C', ANTHROPIC_API_KEY: 'k' } }, /no permitidas: ANTHROPIC_API_KEY/],
      [{ ...SPEC_BASE, environment: { PATH: '/tmp' } }, /no permitidas: PATH/],
      [{ ...SPEC_BASE, maxTimeMs: 0 }, /tiempoMaxMs debe estar entre 1 y 600000/],
      [{ ...SPEC_BASE, maxTimeMs: 600_001 }, /tiempoMaxMs debe estar entre 1 y 600000/],
      [{ ...SPEC_BASE, maxTimeMs: 1.5 }, /entero/],
      [{ ...SPEC_BASE, limits: { memoryMb: 1_000_000 } }, /memoriaMb debe estar entre/],
      [{ ...SPEC_BASE, limits: { pids: 0 } }, /pids debe estar entre/],
      [{ ...SPEC_BASE, command: [] }, /al menos un elemento/],
      [{ ...SPEC_BASE, command: ['node', 'a\0b'] }, /NUL/],
    ];
    for (const [spec, reason] of rejections) {
      // El spec va en el objeto comparado para que un fallo diga qué caso no se rechazó.
      expect({ spec, rejection: rejectionOf(spec) }).toEqual({ spec, rejection: expect.stringMatching(reason) });
      expect(() => dockerArguments(spec as JobSpecInput, 'demiurgo-prueba')).toThrow(InvalidJobSpec);
    }
    expect(validateJobSpec(SPEC_BASE)).toEqual({
      ...SPEC_BASE,
      limits: { cpus: 1, memoryMb: 512, pids: 128 },
      environment: {},
    });
  });

  it('AC-ESQ-001-12 el runner rechaza un JobSpec no permitido sin intentar lanzar ningún contenedor', async () => {
    // Con un ejecutable de docker inexistente, cualquier intento de lanzar daría `infra`;
    // el rechazo llega antes, al validar el spec.
    const options = { dockerBinary: 'docker-inexistente-demiurgo' };
    const invalid = [
      { ...SPEC_BASE, image: 'node:24.21-alpine' },
      { ...SPEC_BASE, mounts: ['/:/host'] },
      { ...SPEC_BASE, privileged: true },
      { ...SPEC_BASE, environment: { DATABASE_URL: 'postgres://x' } },
    ];
    for (const spec of invalid) {
      await expect(runJob(spec, options)).rejects.toThrow(InvalidJobSpec);
    }
  });

  it('AC-ESQ-001-12 argumentosDocker nunca contiene -v, --mount, --privileged ni --network host para ningún JobSpec válido', () => {
    const text = fc.string({ maxLength: 40 }).filter((s) => !s.includes('\0'));
    const dangerous = fc.constantFrom('-v', '--mount', '--privileged', '--network', 'host', '--volume=/:/host', '-u', '0');
    const spec = fc.record(
      {
        image: fc.constant(IMAGE),
        command: fc.array(fc.oneof(text, dangerous), { minLength: 1, maxLength: 6 }).filter((c) => (c[0] ?? '').length > 0),
        input: fc.option(fc.oneof(text, dangerous), { nil: undefined }),
        maxTimeMs: fc.integer({ min: 1, max: 600_000 }),
        limits: fc.record({
          cpus: fc.double({ min: 0.1, max: 4, noNaN: true }),
          memoryMb: fc.integer({ min: 64, max: 4096 }),
          pids: fc.integer({ min: 16, max: 1024 }),
        }),
        environment: fc.dictionary(
          fc.constantFrom(...ALLOWED_ENV),
          fc.oneof(fc.stringMatching(/^[\x20-\x7e]{0,30}$/), dangerous),
        ),
      },
      { requiredKeys: ['image', 'command', 'maxTimeMs'] },
    );
    fc.assert(
      fc.property(spec, (s) => {
        const args = dockerArguments(s, 'demiurgo-prueba');
        const { flags, image, command } = analyze(args);
        // Todo lo anterior a la imagen son flags conocidos del broker; lo posterior es el comando tal cual.
        expect(image).toBe(IMAGE);
        expect(command).toEqual(s.command);
        const options = args.slice(0, args.indexOf(IMAGE));
        for (const forbidden of ['-v', '--volume', '--mount', '--privileged', '--device', '--cap-add', '--pid', '--ipc']) {
          expect(options.some((a) => a === forbidden || a.startsWith(`${forbidden}=`))).toBe(false);
        }
        expect(values(flags, '--network')).toEqual(['none']);
        expect(values(flags, '--user')).toEqual(['1000:1000']);
        for (const [flag, value] of flags.filter(([f]) => f === '--env')) {
          expect(flag).toBe('--env');
          expect(ALLOWED_ENV).toContain(String(value).split('=')[0]);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('AC-RUN-001-01 argumentosDocker incluye usuario no root, cap-drop ALL, no-new-privileges, read-only, network none y los tres límites', () => {
    const args = dockerArguments(
      { ...SPEC_BASE, input: 'console.log(1)', limits: { cpus: 0.5, memoryMb: 256, pids: 64 }, environment: { LANG: 'C.UTF-8' } },
      'demiurgo-prueba',
    );
    const { flags, image } = analyze(args);
    expect(image).toBe(IMAGE);
    expect(values(flags, '--rm')).toEqual([true]);
    expect(values(flags, '--name')).toEqual(['demiurgo-prueba']);
    expect(values(flags, '--label')).toEqual(['demiurgo.runner=1']);
    expect(values(flags, '--user')).toEqual(['1000:1000']);
    expect(values(flags, '--cap-drop')).toEqual(['ALL']);
    expect(values(flags, '--security-opt')).toEqual(['no-new-privileges']);
    expect(values(flags, '--read-only')).toEqual([true]);
    expect(values(flags, '--network')).toEqual(['none']);
    expect(values(flags, '--tmpfs')).toEqual(['/tmp:rw,noexec,nosuid,size=64m']);
    expect(values(flags, '--pull')).toEqual(['never']);
    expect(values(flags, '--pids-limit')).toEqual(['64']);
    expect(values(flags, '--memory')).toEqual(['256m']);
    expect(values(flags, '--memory-swap')).toEqual(['256m']);
    expect(values(flags, '--cpus')).toEqual(['0.5']);
    expect(values(flags, '-i')).toEqual([true]);
    expect(values(flags, '--env')).toEqual(['LANG=C.UTF-8']);
    // Sin entrada no se abre stdin; con los valores por defecto los límites siguen presentes.
    const withoutInput = analyze(dockerArguments(SPEC_BASE, 'demiurgo-prueba')).flags;
    expect(values(withoutInput, '-i')).toEqual([]);
    expect(values(withoutInput, '--pids-limit')).toEqual(['128']);
    expect(values(withoutInput, '--memory')).toEqual(['512m']);
    expect(values(withoutInput, '--cpus')).toEqual(['1']);
    expect(() => dockerArguments(SPEC_BASE, '--privileged')).toThrow(/Nombre de contenedor no válido/);
  });

  it('AC-ESQ-001-11 el proceso docker solo hereda el entorno mínimo de la CLI', () => {
    const environment = dockerEnv({
      Path: 'C:\\Windows',
      SystemRoot: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\x',
      DOCKER_HOST: 'npipe:////./pipe/docker_engine',
      DATABASE_URL: 'postgres://secreto',
      PGPASSWORD: 'secret',
      DEMIURGO_SECRET: 'secret',
      ANTHROPIC_API_KEY: 'secret',
      OPENAI_API_KEY: 'secret',
      DOCKER_AUTH_CONFIG: 'secret',
    });
    expect(environment).toEqual({
      PATH: 'C:\\Windows',
      SystemRoot: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\x',
      DOCKER_HOST: 'npipe:////./pipe/docker_engine',
    });
  });
});

describe('runner con docker', () => {
  beforeAll(() => {
    try {
      execFileSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' });
    } catch {
      execFileSync('docker', ['pull', IMAGE], { stdio: 'inherit' });
    }
  });

  it('AC-RUN-001-01 ejecuta un trabajo con entrada y distingue el fallo del trabajo del fallo del runner', async () => {
    const ok = await runJob({
      ...SPEC_BASE,
      command: ['node', '-'],
      input: 'console.log("hola " + process.getuid())',
    });
    expect(ok).toMatchObject({ state: 'ok', exitCode: 0, stdout: 'hola 1000\n' });
    expect(ok.failureKind).toBeUndefined();
    const failure = await runJob({ ...SPEC_BASE, command: ['node', '-e', 'process.exit(3)'] });
    expect(failure).toMatchObject({ state: 'failure', exitCode: 3 });
    expect(failure.failureKind).toBeUndefined();
    expect(containerExists(ok.container)).toBe(false);
    expect(containerExists(failure.container)).toBe(false);
  });

  it('AC-RUN-001-02 un trabajo que supera tiempoMaxMs termina con timeout y el contenedor ya no existe', async () => {
    const name = `demiurgo-prueba-timeout-${process.pid}-${Date.now()}`;
    const start = performance.now();
    const r = await runJob({ ...SPEC_BASE, command: ['sleep', '30'], maxTimeMs: 3000 }, { containerName: name });
    const ms = performance.now() - start;
    expect(r).toMatchObject({ state: 'failure', failureKind: 'timeout', container: name });
    expect(ms).toBeGreaterThanOrEqual(3000);
    expect(ms).toBeLessThan(15_000);
    expect(containerExists(name)).toBe(false);
  });

  it('AC-RUN-001-02 un AbortSignal cancela el trabajo, mata el contenedor y devuelve cancelled', async () => {
    const name = `demiurgo-prueba-cancelar-${process.pid}-${Date.now()}`;
    const control = new AbortController();
    setTimeout(() => control.abort(), 2000);
    const start = performance.now();
    const r = await runJob(
      { ...SPEC_BASE, command: ['sleep', '30'], maxTimeMs: 60_000 },
      { containerName: name, signal: control.signal },
    );
    expect(r).toMatchObject({ state: 'failure', failureKind: 'cancelled' });
    expect(performance.now() - start).toBeLessThan(15_000);
    expect(containerExists(name)).toBe(false);
    // Una señal ya cancelada no llega a lanzar nada.
    const prior = await runJob(SPEC_BASE, { signal: AbortSignal.abort() });
    expect(prior).toMatchObject({ state: 'failure', failureKind: 'cancelled', durationMs: 0 });
  });

  it('AC-RUN-001-02 si docker no arranca el fallo es infra', async () => {
    const r = await runJob(SPEC_BASE, { dockerBinary: 'docker-inexistente-demiurgo' });
    expect(r).toMatchObject({ state: 'failure', failureKind: 'infra', exitCode: null });
    expect(r.stderr).toMatch(/No se pudo lanzar docker/);
  });

  describe('probe', () => {
    const FAKE = {
      DATABASE_URL: 'postgres://demiurgo:demiurgo-dev@127.0.0.1:55432/postgres',
      ANTHROPIC_API_KEY: 'sk-ant-falsa',
      OPENAI_API_KEY: 'sk-falsa',
      DEMIURGO_SECRET: 'secreto-falso',
      PGPASSWORD: 'demiurgo-dev',
    };
    const priors: Record<string, string | undefined> = {};
    let controlDir = '';

    beforeAll(() => {
      for (const [k, v] of Object.entries(FAKE)) {
        priors[k] = process.env[k];
        process.env[k] = v;
      }
      controlDir = mkdtempSync(join(tmpdir(), 'demiurgo-sonda-'));
    });
    afterAll(() => {
      for (const k of Object.keys(FAKE)) {
        const v = priors[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      rmSync(controlDir, { recursive: true, force: true });
    });

    it('AC-ESQ-001-11 la sonda en el runner no ve credenciales ni ficheros sensibles, no abre conexiones, no escribe fuera de /tmp y no es root', async () => {
      // Precondición: el Postgres de desarrollo sí escucha en el host.
      expect(await isPortOpen('127.0.0.1', 55432)).toBe(true);
      const { report, violations, durationMs, result } = await runProbe();
      expect(violations).toEqual([]);
      expect(report.uid).not.toBe(0);
      expect(report.uid).toBe(1000);
      expect(report.sensitiveVariables).toEqual([]);
      for (const k of Object.keys(FAKE)) expect(report.visibleVariables).not.toContain(k);
      expect(report.visibleVariables).toContain('CI');
      expect(result.stdout).not.toMatch(/demiurgo-dev|sk-ant-falsa|secreto-falso/);
      expect(report.visibleFiles).toEqual([]);
      expect(report.paths.every((r) => r.state !== 'visible')).toBe(true);
      expect(report.connections.length).toBeGreaterThanOrEqual(7);
      expect(report.connections.filter((c) => c.connected)).toEqual([]);
      expect(report.connections.map((c) => c.target)).toContain('host.docker.internal:55432');
      expect(report.writeOutsideTmp.map((e) => e.goal)).toEqual(expect.arrayContaining(['/', '.']));
      expect(report.writeOutsideTmp.filter((e) => e.written)).toEqual([]);
      expect(report.writeInTmp.written).toBe(true);
      expect(report.proc).toMatchObject({ capEff: '0000000000000000', noNewPrivs: '1' });
      expect(durationMs).toBeLessThan(30_000);
    });

    it('AC-ESQ-001-11 control: fuera del runner la misma sonda sí detecta credenciales, ficheros, conexiones y escrituras', async () => {
      const file = join(controlDir, 'credenciales.json');
      writeFileSync(file, '{}');
      const script = generateProbeScript({
        sensitivePaths: [file, join(controlDir, 'no-existe')],
        tcpTargets: [{ host: '127.0.0.1', port: 55432 }],
        dnsNames: ['localhost'],
        writePaths: [controlDir],
        tmpPath: controlDir,
        connectionTimeoutMs: 2000,
      });
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, ['-'], { cwd: controlDir, env: process.env, stdio: ['pipe', 'pipe', 'inherit'] });
        let text = '';
        child.stdout.on('data', (t: Buffer) => {
          text += t.toString('utf8');
        });
        child.once('error', reject);
        child.once('close', () => resolve(text));
        child.stdin.end(script);
      });
      const report = probeReportSchema.parse(JSON.parse(output));
      expect(report.sensitiveVariables).toEqual(expect.arrayContaining(Object.keys(FAKE)));
      expect(report.visibleFiles).toEqual([file]);
      expect(report.connections.filter((c) => c.connected).map((c) => c.target)).toEqual(['127.0.0.1:55432', 'localhost']);
      expect(report.writeOutsideTmp.every((e) => e.written)).toBe(true);
      const violations = probeViolations(report);
      expect(violations.join(' ')).toMatch(/Variables sensibles visibles: .*DATABASE_URL/);
      expect(violations.join(' ')).toMatch(/Ficheros sensibles visibles/);
      expect(violations.join(' ')).toMatch(/Conexión tcp abierta con 127\.0\.0\.1:55432/);
      expect(violations.join(' ')).toMatch(/Escritura fuera de \/tmp/);
    });
  });
});
