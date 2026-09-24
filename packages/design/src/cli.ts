// CLI del formato de diseño.
//   node packages/design/src/cli.ts validar [dir]
//   node packages/design/src/cli.ts canonizar [dir]
//   node packages/design/src/cli.ts derivar --comprobar | --escribir
//   node packages/design/src/cli.ts trazabilidad   (lee reports/junit-*.xml)
//   node packages/design/src/cli.ts estado-ac      (tabla Markdown del estado de cada AC)

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validarArbol } from './arbol.ts';
import { RUTA_MODULO_TABLAS, generarModuloTablas } from './deriva.ts';
import { leerArbol } from './disco.ts';
import { normalizarEspacios, parsearDocumento, renderizarDocumento } from './formato.ts';
import { README_DISENO } from './readme.ts';
import { casosDeJUnit, codigosCitados, informeCompleto, mapaTrazabilidad } from './trazabilidad.ts';

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
  let codigo = 0;
  for (const [ruta, texto] of arbol) {
    let canonico: string;
    if (ruta.endsWith('.yaml')) {
      // En un anexo solo se arreglan los finales de línea y los espacios finales.
      canonico = texto.replaceAll('\r\n', '\n').replace(/[^\S\n]+$/gm, '');
    } else if (ruta.endsWith('.md') && ruta !== 'README.md') {
      const r = parsearDocumento(normalizarEspacios(texto), ruta);
      if (!r.ok) {
        for (const p of r.problemas) console.error(`✗ ${p.ruta}: ${p.mensaje}`);
        codigo = 1;
        continue;
      }
      canonico = renderizarDocumento(r.valor);
    } else {
      continue;
    }
    if (canonico !== texto) {
      await writeFile(join(DIR, ...ruta.split('/')), canonico, 'utf8');
      n++;
    }
  }
  await writeFile(join(DIR, 'README.md'), README_DISENO, 'utf8');
  console.log(`Reescritos ${n} archivo(s) y README.md.`);
  return codigo;
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

const DIR_INFORMES = 'reports';

/** Lee todos los `reports/junit-*.xml`: cada etapa de pruebas escribe el suyo. */
async function informesJUnit(): Promise<Map<string, string>> {
  const informes = new Map<string, string>();
  const nombres = await readdir(DIR_INFORMES).catch(() => [] as string[]);
  for (const nombre of nombres.filter((n) => /^junit-.+\.xml$/.test(n)).sort()) {
    informes.set(`${DIR_INFORMES}/${nombre}`, await readFile(join(DIR_INFORMES, nombre), 'utf8'));
  }
  return informes;
}

async function trazabilidad(): Promise<number> {
  const informe = validarArbol(await leerArbol(DIR));
  if (informe.problemas.length > 0) {
    console.error(`✗ ${DIR}/ no es válido: ejecuta antes «pnpm gate:design».`);
    return 1;
  }
  const informes = await informesJUnit();
  if (informes.size === 0) {
    console.error(
      `✗ No hay informes JUnit en ${DIR_INFORMES}/ (junit-*.xml): ejecuta antes pnpm gate:test y pnpm gate:invariantes.`,
    );
    return 1;
  }
  const incompletos = [...informes].filter(([, xml]) => !informeCompleto(xml)).map(([ruta]) => ruta);
  if (incompletos.length > 0) {
    for (const ruta of incompletos) console.error(`✗ ${ruta} está vacío o incompleto: vuelve a ejecutar sus pruebas.`);
    return 1;
  }
  const casos = [...informes.values()].flatMap(casosDeJUnit);
  const raiz = JSON.parse(await readFile('package.json', 'utf8')) as { demiurgo?: { incrementosImplementados?: string[] } };
  const implementados = raiz.demiurgo?.incrementosImplementados ?? [];
  const mapa = mapaTrazabilidad(informe.registros, casos, implementados);
  const pasadas = casos.filter((c) => c.resultado === 'pasada').length;
  console.log(`Informes leídos: ${[...informes.keys()].join(', ')} (${casos.length} pruebas, ${pasadas} pasadas).`);
  let codigo = 0;
  for (const d of mapa.desconocidos) {
    console.error(`✗ ${d.archivo}: la prueba «${d.prueba}» cita ${d.ac}, que no existe en ${DIR}/.`);
    codigo = 1;
  }
  for (const s of mapa.sinPrueba) {
    console.error(`✗ ${s.ac} (${s.registro}): criterio automático sin ninguna prueba pasada que empiece por su código.`);
    codigo = 1;
  }
  if (codigo === 0) {
    console.log(
      `✓ Trazabilidad AC → prueba completa para ${implementados.join(', ') || '(ningún incremento)'}: ${mapa.pruebasPorAc.size} criterios con prueba pasada.`,
    );
  }
  return codigo;
}

/** Tabla Markdown con el estado de cada AC: verde, rojo, manual o no implementado. */
async function estadoAc(): Promise<number> {
  const informe = validarArbol(await leerArbol(DIR));
  const casos = [...(await informesJUnit()).values()].flatMap(casosDeJUnit);
  const raiz = JSON.parse(await readFile('package.json', 'utf8')) as { demiurgo?: { incrementosImplementados?: string[] } };
  const implementados = raiz.demiurgo?.incrementosImplementados ?? [];
  const porAc = new Map<string, { pasadas: number; fallidas: number }>();
  for (const c of casos) {
    for (const ac of codigosCitados(c.nombre)) {
      const e = porAc.get(ac) ?? { pasadas: 0, fallidas: 0 };
      if (c.resultado === 'pasada') e.pasadas++;
      if (c.resultado === 'fallida') e.fallidas++;
      porAc.set(ac, e);
    }
  }
  const filas = ['| AC | Registro | Título | Verificación | Estado | Pruebas |', '|---|---|---|---|---|---|'];
  for (const r of informe.registros) {
    for (const c of r.criterios) {
      const e = porAc.get(c.codigo) ?? { pasadas: 0, fallidas: 0 };
      let estado: string;
      if (c.verificacion === 'manual') estado = 'manual';
      else if (!r.incremento || !implementados.includes(r.incremento)) estado = 'no implementado';
      else if (e.fallidas > 0) estado = 'rojo';
      else if (e.pasadas > 0) estado = 'verde';
      else estado = 'rojo (sin prueba)';
      filas.push(
        `| ${c.codigo} | ${r.codigo} | ${c.titulo.replaceAll('|', '/')} | ${c.verificacion} | ${estado} | ${e.pasadas} pasadas${e.fallidas ? `, ${e.fallidas} fallidas` : ''} |`,
      );
    }
  }
  console.log(filas.join(String.fromCharCode(10)));
  return 0;
}

const ordenes: Record<string, () => Promise<number>> = { validar, canonizar, derivar, trazabilidad, 'estado-ac': estadoAc };
const accion = orden ? ordenes[orden] : undefined;
if (!accion) {
  console.error('Uso: cli.ts validar|canonizar|derivar|trazabilidad|estado-ac [dir] [--comprobar|--escribir]');
  process.exitCode = 2;
} else {
  process.exitCode = await accion();
}
