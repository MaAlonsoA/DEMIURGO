// CLI del formato de diseño.
//   node packages/design/src/cli.ts validar [dir]
//   node packages/design/src/cli.ts canonizar [dir]
//   node packages/design/src/cli.ts derivar --comprobar | --escribir
//   node packages/design/src/cli.ts trazabilidad

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validarArbol } from './arbol.ts';
import { RUTA_MODULO_TABLAS, generarModuloTablas } from './deriva.ts';
import { leerArbol } from './disco.ts';
import { parsearDocumento, renderizarDocumento } from './formato.ts';
import { README_DISENO } from './readme.ts';
import { mapaTrazabilidad } from './trazabilidad.ts';

const [orden, ...args] = process.argv.slice(2);
const DIR = args.find((a) => !a.startsWith('--')) ?? 'design';

async function validar(): Promise<number> {
  const informe = validarArbol(await leerArbol(DIR));
  if (informe.problemas.length > 0) {
    for (const p of informe.problemas) console.error(`✗ ${p.ruta}: ${p.mensaje}`);
    console.error(`\n${informe.problemas.length} problema(s) en ${DIR}/.`);
    return 1;
  }
  const acs = informe.registros.reduce((n, r) => n + r.criterios.length, 0);
  console.log(
    `✓ ${DIR}/ válido: ${informe.registros.length} registros, ${acs} criterios, ${informe.taxonomias.length} taxonomía(s), ${informe.anexos.size} anexo(s).`,
  );
  return 0;
}

async function canonizar(): Promise<number> {
  const arbol = await leerArbol(DIR);
  let n = 0;
  for (const [ruta, texto] of arbol) {
    if (!ruta.endsWith('.md') || ruta === 'README.md') continue;
    const r = parsearDocumento(texto.replaceAll('\r\n', '\n'), ruta);
    if (!r.ok) {
      for (const p of r.problemas) console.error(`✗ ${p.ruta}: ${p.mensaje}`);
      continue;
    }
    const canonico = renderizarDocumento(r.valor);
    if (canonico !== texto) {
      await writeFile(join(DIR, ...ruta.split('/')), canonico, 'utf8');
      n++;
    }
  }
  await writeFile(join(DIR, 'README.md'), README_DISENO, 'utf8');
  console.log(`Reescritos ${n} documento(s) y README.md.`);
  return 0;
}

async function derivar(): Promise<number> {
  const cap = await readFile(join(DIR, 'datos', 'capacidades.yaml'), 'utf8');
  const tra = await readFile(join(DIR, 'datos', 'transiciones.yaml'), 'utf8');
  const generado = generarModuloTablas(cap, tra);
  if (args.includes('--escribir')) {
    await writeFile(RUTA_MODULO_TABLAS, generado, 'utf8');
    console.log(`Escrito ${RUTA_MODULO_TABLAS}.`);
    return 0;
  }
  const actual = await readFile(RUTA_MODULO_TABLAS, 'utf8').catch(() => '');
  if (actual !== generado) {
    console.error(`✗ ${RUTA_MODULO_TABLAS} no coincide con design/datos/. Ejecuta «pnpm gen».`);
    return 1;
  }
  console.log('✓ Las tablas del dominio coinciden con design/datos/.');
  return 0;
}

async function archivosDePrueba(): Promise<Map<string, string>> {
  const archivos = new Map<string, string>();
  for (const paquete of await readdir('packages')) {
    const dir = join('packages', paquete, 'test');
    const entradas = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
    for (const e of entradas) {
      if (e.isFile() && e.name.endsWith('.test.ts')) {
        const ruta = join(e.parentPath, e.name);
        archivos.set(ruta.replaceAll('\\', '/'), await readFile(ruta, 'utf8'));
      }
    }
  }
  return archivos;
}

async function trazabilidad(): Promise<number> {
  const informe = validarArbol(await leerArbol(DIR));
  const raiz = JSON.parse(await readFile('package.json', 'utf8')) as { demiurgo?: { incrementosImplementados?: string[] } };
  const implementados = raiz.demiurgo?.incrementosImplementados ?? [];
  const mapa = mapaTrazabilidad(informe.registros, await archivosDePrueba(), implementados);
  let codigo = 0;
  for (const d of mapa.desconocidos) {
    console.error(`✗ ${d.archivo}: la prueba cita ${d.ac}, que no existe en ${DIR}/.`);
    codigo = 1;
  }
  for (const s of mapa.sinPrueba) {
    console.error(`✗ ${s.ac} (${s.registro}): criterio automático sin prueba.`);
    codigo = 1;
  }
  if (codigo === 0) {
    console.log(
      `✓ Trazabilidad AC → prueba completa para ${implementados.join(', ') || '(ningún incremento)'}: ${mapa.pruebasPorAc.size} criterios con prueba.`,
    );
  }
  return codigo;
}

const ordenes: Record<string, () => Promise<number>> = { validar, canonizar, derivar, trazabilidad };
const accion = orden ? ordenes[orden] : undefined;
if (!accion) {
  console.error('Uso: cli.ts validar|canonizar|derivar|trazabilidad [dir] [--comprobar|--escribir]');
  process.exitCode = 2;
} else {
  process.exitCode = await accion();
}
