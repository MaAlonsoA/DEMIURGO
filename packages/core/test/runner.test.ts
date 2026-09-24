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
  argumentosDocker,
  ENTORNO_PERMITIDO,
  ejecutarSonda,
  ejecutarTrabajo,
  entornoDocker,
  esquemaInformeSonda,
  generarScriptSonda,
  IMAGENES_PERMITIDAS,
  type JobSpecEntrada,
  JobSpecInvalido,
  validarJobSpec,
  violacionesSonda,
} from '../src/runner/index.ts';

const IMAGEN = IMAGENES_PERMITIDAS[0] ?? '';
const SPEC_BASE: JobSpecEntrada = { imagen: IMAGEN, comando: ['node', '-e', '0'], tiempoMaxMs: 10_000 };

/** Flags de docker que el broker puede emitir: con valor y sin valor. */
const FLAGS_CON_VALOR = new Set([
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
const FLAGS_SIN_VALOR = new Set(['--rm', '--read-only', '-i']);

/** Separa los argumentos de `docker run` en pares flag → valor hasta la imagen. */
function analizar(args: string[]): { flags: [string, string | true][]; imagen: string; comando: string[] } {
  expect(args[0]).toBe('run');
  const flags: [string, string | true][] = [];
  let i = 1;
  while (i < args.length) {
    const a = args[i] ?? '';
    if (FLAGS_SIN_VALOR.has(a)) {
      flags.push([a, true]);
      i += 1;
    } else if (FLAGS_CON_VALOR.has(a)) {
      flags.push([a, args[i + 1] ?? '']);
      i += 2;
    } else {
      break;
    }
  }
  return { flags, imagen: args[i] ?? '', comando: args.slice(i + 1) };
}

/** Mensaje de rechazo de un spec, o `aceptado` si el esquema lo admite. */
function rechazoDe(spec: unknown): string {
  try {
    validarJobSpec(spec);
    return 'aceptado';
  } catch (e) {
    return e instanceof JobSpecInvalido ? e.message : `error inesperado: ${String(e)}`;
  }
}

const valores = (flags: [string, string | true][], flag: string) => flags.filter(([f]) => f === flag).map(([, v]) => v);

function contenedorExiste(nombre: string): boolean {
  const salida = execFileSync('docker', ['ps', '-a', '--filter', `name=^/${nombre}$`, '--format', '{{.Names}}'], {
    encoding: 'utf8',
  });
  return salida.trim().length > 0;
}

function puertoAbierto(host: string, puerto: number, ms = 2000): Promise<boolean> {
  return new Promise((resolver) => {
    const s = connect({ host, port: puerto });
    const fin = (ok: boolean) => {
      s.destroy();
      resolver(ok);
    };
    s.setTimeout(ms, () => fin(false));
    s.once('connect', () => fin(true));
    s.once('error', () => fin(false));
  });
}

describe('JobSpec cerrado y argumentos de docker', () => {
  it('AC-ESQ-001-12 el esquema rechaza imagen sin digest, fuera de la lista, claves extra, entorno no permitido y tiempos fuera de rango', () => {
    const rechazos: [unknown, RegExp][] = [
      [{ ...SPEC_BASE, imagen: 'node:24.21-alpine' }, /fijada por digest/],
      [{ ...SPEC_BASE, imagen: 'node:latest' }, /fijada por digest/],
      [{ ...SPEC_BASE, imagen: `node:24.21-alpine@sha256:${'0'.repeat(64)}` }, /no está en la lista de imágenes permitidas/],
      [{ ...SPEC_BASE, imagen: `alpine:3.22@sha256:${'a'.repeat(64)}` }, /no está en la lista de imágenes permitidas/],
      [{ ...SPEC_BASE, montajes: ['/:/host'] }, /Opciones no admitidas en el JobSpec: montajes/],
      [{ ...SPEC_BASE, red: 'host' }, /Opciones no admitidas en el JobSpec: red/],
      [{ ...SPEC_BASE, privilegiado: true }, /Opciones no admitidas en el JobSpec: privilegiado/],
      [{ ...SPEC_BASE, usuario: 'root' }, /Opciones no admitidas en el JobSpec: usuario/],
      [{ ...SPEC_BASE, limites: { cpus: 1, privilegiado: true } }, /Límites no admitidos: privilegiado/],
      [{ ...SPEC_BASE, entorno: { DATABASE_URL: 'postgres://x' } }, /Variables de entorno no permitidas: DATABASE_URL/],
      [{ ...SPEC_BASE, entorno: { LANG: 'C', ANTHROPIC_API_KEY: 'k' } }, /no permitidas: ANTHROPIC_API_KEY/],
      [{ ...SPEC_BASE, entorno: { PATH: '/tmp' } }, /no permitidas: PATH/],
      [{ ...SPEC_BASE, tiempoMaxMs: 0 }, /tiempoMaxMs debe estar entre 1 y 600000/],
      [{ ...SPEC_BASE, tiempoMaxMs: 600_001 }, /tiempoMaxMs debe estar entre 1 y 600000/],
      [{ ...SPEC_BASE, tiempoMaxMs: 1.5 }, /entero/],
      [{ ...SPEC_BASE, limites: { memoriaMb: 1_000_000 } }, /memoriaMb debe estar entre/],
      [{ ...SPEC_BASE, limites: { pids: 0 } }, /pids debe estar entre/],
      [{ ...SPEC_BASE, comando: [] }, /al menos un elemento/],
      [{ ...SPEC_BASE, comando: ['node', 'a\0b'] }, /NUL/],
    ];
    for (const [spec, motivo] of rechazos) {
      // El spec va en el objeto comparado para que un fallo diga qué caso no se rechazó.
      expect({ spec, rechazo: rechazoDe(spec) }).toEqual({ spec, rechazo: expect.stringMatching(motivo) });
      expect(() => argumentosDocker(spec as JobSpecEntrada, 'demiurgo-prueba')).toThrow(JobSpecInvalido);
    }
    expect(validarJobSpec(SPEC_BASE)).toEqual({
      ...SPEC_BASE,
      limites: { cpus: 1, memoriaMb: 512, pids: 128 },
      entorno: {},
    });
  });

  it('AC-ESQ-001-12 el runner rechaza un JobSpec no permitido sin intentar lanzar ningún contenedor', async () => {
    // Con un ejecutable de docker inexistente, cualquier intento de lanzar daría `infra`;
    // el rechazo llega antes, al validar el spec.
    const opciones = { binarioDocker: 'docker-inexistente-demiurgo' };
    const invalidos = [
      { ...SPEC_BASE, imagen: 'node:24.21-alpine' },
      { ...SPEC_BASE, montajes: ['/:/host'] },
      { ...SPEC_BASE, privilegiado: true },
      { ...SPEC_BASE, entorno: { DATABASE_URL: 'postgres://x' } },
    ];
    for (const spec of invalidos) {
      await expect(ejecutarTrabajo(spec, opciones)).rejects.toThrow(JobSpecInvalido);
    }
  });

  it('AC-ESQ-001-12 argumentosDocker nunca contiene -v, --mount, --privileged ni --network host para ningún JobSpec válido', () => {
    const texto = fc.string({ maxLength: 40 }).filter((s) => !s.includes('\0'));
    const peligroso = fc.constantFrom('-v', '--mount', '--privileged', '--network', 'host', '--volume=/:/host', '-u', '0');
    const spec = fc.record(
      {
        imagen: fc.constant(IMAGEN),
        comando: fc.array(fc.oneof(texto, peligroso), { minLength: 1, maxLength: 6 }).filter((c) => (c[0] ?? '').length > 0),
        entrada: fc.option(fc.oneof(texto, peligroso), { nil: undefined }),
        tiempoMaxMs: fc.integer({ min: 1, max: 600_000 }),
        limites: fc.record({
          cpus: fc.double({ min: 0.1, max: 4, noNaN: true }),
          memoriaMb: fc.integer({ min: 64, max: 4096 }),
          pids: fc.integer({ min: 16, max: 1024 }),
        }),
        entorno: fc.dictionary(
          fc.constantFrom(...ENTORNO_PERMITIDO),
          fc.oneof(fc.stringMatching(/^[\x20-\x7e]{0,30}$/), peligroso),
        ),
      },
      { requiredKeys: ['imagen', 'comando', 'tiempoMaxMs'] },
    );
    fc.assert(
      fc.property(spec, (s) => {
        const args = argumentosDocker(s, 'demiurgo-prueba');
        const { flags, imagen, comando } = analizar(args);
        // Todo lo anterior a la imagen son flags conocidos del broker; lo posterior es el comando tal cual.
        expect(imagen).toBe(IMAGEN);
        expect(comando).toEqual(s.comando);
        const opciones = args.slice(0, args.indexOf(IMAGEN));
        for (const prohibido of ['-v', '--volume', '--mount', '--privileged', '--device', '--cap-add', '--pid', '--ipc']) {
          expect(opciones.some((a) => a === prohibido || a.startsWith(`${prohibido}=`))).toBe(false);
        }
        expect(valores(flags, '--network')).toEqual(['none']);
        expect(valores(flags, '--user')).toEqual(['1000:1000']);
        for (const [flag, valor] of flags.filter(([f]) => f === '--env')) {
          expect(flag).toBe('--env');
          expect(ENTORNO_PERMITIDO).toContain(String(valor).split('=')[0]);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('AC-RUN-001-01 argumentosDocker incluye usuario no root, cap-drop ALL, no-new-privileges, read-only, network none y los tres límites', () => {
    const args = argumentosDocker(
      { ...SPEC_BASE, entrada: 'console.log(1)', limites: { cpus: 0.5, memoriaMb: 256, pids: 64 }, entorno: { LANG: 'C.UTF-8' } },
      'demiurgo-prueba',
    );
    const { flags, imagen } = analizar(args);
    expect(imagen).toBe(IMAGEN);
    expect(valores(flags, '--rm')).toEqual([true]);
    expect(valores(flags, '--name')).toEqual(['demiurgo-prueba']);
    expect(valores(flags, '--label')).toEqual(['demiurgo.runner=1']);
    expect(valores(flags, '--user')).toEqual(['1000:1000']);
    expect(valores(flags, '--cap-drop')).toEqual(['ALL']);
    expect(valores(flags, '--security-opt')).toEqual(['no-new-privileges']);
    expect(valores(flags, '--read-only')).toEqual([true]);
    expect(valores(flags, '--network')).toEqual(['none']);
    expect(valores(flags, '--tmpfs')).toEqual(['/tmp:rw,noexec,nosuid,size=64m']);
    expect(valores(flags, '--pull')).toEqual(['never']);
    expect(valores(flags, '--pids-limit')).toEqual(['64']);
    expect(valores(flags, '--memory')).toEqual(['256m']);
    expect(valores(flags, '--memory-swap')).toEqual(['256m']);
    expect(valores(flags, '--cpus')).toEqual(['0.5']);
    expect(valores(flags, '-i')).toEqual([true]);
    expect(valores(flags, '--env')).toEqual(['LANG=C.UTF-8']);
    // Sin entrada no se abre stdin; con los valores por defecto los límites siguen presentes.
    const sinEntrada = analizar(argumentosDocker(SPEC_BASE, 'demiurgo-prueba')).flags;
    expect(valores(sinEntrada, '-i')).toEqual([]);
    expect(valores(sinEntrada, '--pids-limit')).toEqual(['128']);
    expect(valores(sinEntrada, '--memory')).toEqual(['512m']);
    expect(valores(sinEntrada, '--cpus')).toEqual(['1']);
    expect(() => argumentosDocker(SPEC_BASE, '--privileged')).toThrow(/Nombre de contenedor no válido/);
  });

  it('AC-ESQ-001-11 el proceso docker solo hereda el entorno mínimo de la CLI', () => {
    const entorno = entornoDocker({
      Path: 'C:\\Windows',
      SystemRoot: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\x',
      DOCKER_HOST: 'npipe:////./pipe/docker_engine',
      DATABASE_URL: 'postgres://secreto',
      PGPASSWORD: 'secreto',
      DEMIURGO_SECRETO: 'secreto',
      ANTHROPIC_API_KEY: 'secreto',
      OPENAI_API_KEY: 'secreto',
      DOCKER_AUTH_CONFIG: 'secreto',
    });
    expect(entorno).toEqual({
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
      execFileSync('docker', ['image', 'inspect', IMAGEN], { stdio: 'ignore' });
    } catch {
      execFileSync('docker', ['pull', IMAGEN], { stdio: 'inherit' });
    }
  });

  it('AC-RUN-001-01 ejecuta un trabajo con entrada y distingue el fallo del trabajo del fallo del runner', async () => {
    const ok = await ejecutarTrabajo({
      ...SPEC_BASE,
      comando: ['node', '-'],
      entrada: 'console.log("hola " + process.getuid())',
    });
    expect(ok).toMatchObject({ estado: 'ok', codigoSalida: 0, stdout: 'hola 1000\n' });
    expect(ok.failureKind).toBeUndefined();
    const fallo = await ejecutarTrabajo({ ...SPEC_BASE, comando: ['node', '-e', 'process.exit(3)'] });
    expect(fallo).toMatchObject({ estado: 'fallo', codigoSalida: 3 });
    expect(fallo.failureKind).toBeUndefined();
    expect(contenedorExiste(ok.contenedor)).toBe(false);
    expect(contenedorExiste(fallo.contenedor)).toBe(false);
  });

  it('AC-RUN-001-02 un trabajo que supera tiempoMaxMs termina con timeout y el contenedor ya no existe', async () => {
    const nombre = `demiurgo-prueba-timeout-${process.pid}-${Date.now()}`;
    const inicio = performance.now();
    const r = await ejecutarTrabajo({ ...SPEC_BASE, comando: ['sleep', '30'], tiempoMaxMs: 3000 }, { nombreContenedor: nombre });
    const ms = performance.now() - inicio;
    expect(r).toMatchObject({ estado: 'fallo', failureKind: 'timeout', contenedor: nombre });
    expect(ms).toBeGreaterThanOrEqual(3000);
    expect(ms).toBeLessThan(15_000);
    expect(contenedorExiste(nombre)).toBe(false);
  });

  it('AC-RUN-001-02 un AbortSignal cancela el trabajo, mata el contenedor y devuelve cancelled', async () => {
    const nombre = `demiurgo-prueba-cancelar-${process.pid}-${Date.now()}`;
    const control = new AbortController();
    setTimeout(() => control.abort(), 2000);
    const inicio = performance.now();
    const r = await ejecutarTrabajo(
      { ...SPEC_BASE, comando: ['sleep', '30'], tiempoMaxMs: 60_000 },
      { nombreContenedor: nombre, signal: control.signal },
    );
    expect(r).toMatchObject({ estado: 'fallo', failureKind: 'cancelled' });
    expect(performance.now() - inicio).toBeLessThan(15_000);
    expect(contenedorExiste(nombre)).toBe(false);
    // Una señal ya cancelada no llega a lanzar nada.
    const previa = await ejecutarTrabajo(SPEC_BASE, { signal: AbortSignal.abort() });
    expect(previa).toMatchObject({ estado: 'fallo', failureKind: 'cancelled', duracionMs: 0 });
  });

  it('AC-RUN-001-02 si docker no arranca el fallo es infra', async () => {
    const r = await ejecutarTrabajo(SPEC_BASE, { binarioDocker: 'docker-inexistente-demiurgo' });
    expect(r).toMatchObject({ estado: 'fallo', failureKind: 'infra', codigoSalida: null });
    expect(r.stderr).toMatch(/No se pudo lanzar docker/);
  });

  describe('sonda', () => {
    const FALSAS = {
      DATABASE_URL: 'postgres://demiurgo:demiurgo-dev@127.0.0.1:55432/postgres',
      ANTHROPIC_API_KEY: 'sk-ant-falsa',
      OPENAI_API_KEY: 'sk-falsa',
      DEMIURGO_SECRETO: 'secreto-falso',
      PGPASSWORD: 'demiurgo-dev',
    };
    const previas: Record<string, string | undefined> = {};
    let dirControl = '';

    beforeAll(() => {
      for (const [k, v] of Object.entries(FALSAS)) {
        previas[k] = process.env[k];
        process.env[k] = v;
      }
      dirControl = mkdtempSync(join(tmpdir(), 'demiurgo-sonda-'));
    });
    afterAll(() => {
      for (const k of Object.keys(FALSAS)) {
        const v = previas[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      rmSync(dirControl, { recursive: true, force: true });
    });

    it('AC-ESQ-001-11 la sonda en el runner no ve credenciales ni ficheros sensibles, no abre conexiones, no escribe fuera de /tmp y no es root', async () => {
      // Precondición: el Postgres de desarrollo sí escucha en el host.
      expect(await puertoAbierto('127.0.0.1', 55432)).toBe(true);
      const { informe, violaciones, duracionMs, resultado } = await ejecutarSonda();
      expect(violaciones).toEqual([]);
      expect(informe.uid).not.toBe(0);
      expect(informe.uid).toBe(1000);
      expect(informe.variablesSensibles).toEqual([]);
      for (const k of Object.keys(FALSAS)) expect(informe.variablesVisibles).not.toContain(k);
      expect(informe.variablesVisibles).toContain('CI');
      expect(resultado.stdout).not.toMatch(/demiurgo-dev|sk-ant-falsa|secreto-falso/);
      expect(informe.ficherosVisibles).toEqual([]);
      expect(informe.rutas.every((r) => r.estado !== 'visible')).toBe(true);
      expect(informe.conexiones.length).toBeGreaterThanOrEqual(7);
      expect(informe.conexiones.filter((c) => c.conectado)).toEqual([]);
      expect(informe.conexiones.map((c) => c.destino)).toContain('host.docker.internal:55432');
      expect(informe.escrituraFueraDeTmp.map((e) => e.objetivo)).toEqual(expect.arrayContaining(['/', '.']));
      expect(informe.escrituraFueraDeTmp.filter((e) => e.escrito)).toEqual([]);
      expect(informe.escrituraEnTmp.escrito).toBe(true);
      expect(informe.proceso).toMatchObject({ capEff: '0000000000000000', noNewPrivs: '1' });
      expect(duracionMs).toBeLessThan(30_000);
    });

    it('AC-ESQ-001-11 control: fuera del runner la misma sonda sí detecta credenciales, ficheros, conexiones y escrituras', async () => {
      const fichero = join(dirControl, 'credenciales.json');
      writeFileSync(fichero, '{}');
      const script = generarScriptSonda({
        rutasSensibles: [fichero, join(dirControl, 'no-existe')],
        destinosTcp: [{ host: '127.0.0.1', puerto: 55432 }],
        nombresDns: ['localhost'],
        rutasEscritura: [dirControl],
        rutaTmp: dirControl,
        timeoutConexionMs: 2000,
      });
      const salida = await new Promise<string>((resolver, rechazar) => {
        const hijo = spawn(process.execPath, ['-'], { cwd: dirControl, env: process.env, stdio: ['pipe', 'pipe', 'inherit'] });
        let texto = '';
        hijo.stdout.on('data', (t: Buffer) => {
          texto += t.toString('utf8');
        });
        hijo.once('error', rechazar);
        hijo.once('close', () => resolver(texto));
        hijo.stdin.end(script);
      });
      const informe = esquemaInformeSonda.parse(JSON.parse(salida));
      expect(informe.variablesSensibles).toEqual(expect.arrayContaining(Object.keys(FALSAS)));
      expect(informe.ficherosVisibles).toEqual([fichero]);
      expect(informe.conexiones.filter((c) => c.conectado).map((c) => c.destino)).toEqual(['127.0.0.1:55432', 'localhost']);
      expect(informe.escrituraFueraDeTmp.every((e) => e.escrito)).toBe(true);
      const violaciones = violacionesSonda(informe);
      expect(violaciones.join(' ')).toMatch(/Variables sensibles visibles: .*DATABASE_URL/);
      expect(violaciones.join(' ')).toMatch(/Ficheros sensibles visibles/);
      expect(violaciones.join(' ')).toMatch(/Conexión tcp abierta con 127\.0\.0\.1:55432/);
      expect(violaciones.join(' ')).toMatch(/Escritura fuera de \/tmp/);
    });
  });
});
