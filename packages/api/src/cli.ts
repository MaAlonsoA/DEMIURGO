// CLI de operación de DEMIURGO v2 (usa DEMIURGO_DATABASE_URL y el resto de la configuración).
//   node packages/api/src/cli.ts migrar
//   node packages/api/src/cli.ts crear-persona <usuario>          (la clave se lee de la entrada estándar)
//   node packages/api/src/cli.ts crear-proyecto <nombre>
//   node packages/api/src/cli.ts ejecucion-real <proyectoId> <accion> <json-alcance> [json-entrada]
//   node packages/api/src/cli.ts evaluar-clasificador [prueba|desarrollo|todas]   (usa DEMIURGO_CLASIFICADOR)
//   node packages/api/src/cli.ts importar-diseno <proyectoId> [dir]                (crea el lote pendiente de H1)
//   node packages/api/src/cli.ts exportar-diseno <proyectoId> [--comprobar dir | --salida dir]

import {
  type Particion,
  IMPORTADOR,
  arrancarNucleo,
  compararExportacion,
  exportarDiseno,
  crearClasificador,
  evaluarClasificador,
  resumenEvaluacion,
  conectar,
  ejecutarComando,
  esperarRun,
  leerConfiguracion,
  migrar,
  registroConsola,
} from '@demiurgo/core';
import { escribirArbol, leerArbol } from '@demiurgo/design';
import { sistema } from '@demiurgo/domain';
import { crearPersona } from './credenciales.ts';

const [orden, ...args] = process.argv.slice(2);
const config = leerConfiguracion();

async function leerEntrada(): Promise<string> {
  const trozos: Buffer[] = [];
  for await (const t of process.stdin) trozos.push(t as Buffer);
  return Buffer.concat(trozos).toString('utf8').trim();
}

async function conBase<T>(f: (c: ReturnType<typeof conectar>) => Promise<T>): Promise<T> {
  const c = conectar(config.urlBase);
  try {
    await migrar(c.pool);
    return await f(c);
  } finally {
    await c.cerrar();
  }
}

const ordenes: Record<string, () => Promise<void>> = {
  async migrar() {
    const c = conectar(config.urlBase);
    try {
      console.log(JSON.stringify({ aplicadas: await migrar(c.pool) }));
    } finally {
      await c.cerrar();
    }
  },

  async 'crear-persona'() {
    const usuario = args[0];
    if (!usuario) throw new Error('Uso: crear-persona <usuario> (clave por la entrada estándar)');
    const clave = await leerEntrada();
    await conBase(async (c) => {
      const id = await crearPersona(c.db, usuario, clave);
      console.log(JSON.stringify({ persona: usuario, id }));
    });
  },

  async 'crear-proyecto'() {
    const nombre = args[0];
    if (!nombre) throw new Error('Uso: crear-proyecto <nombre>');
    const nucleo = await arrancarNucleo(config, registroConsola);
    try {
      const r = await ejecutarComando(nucleo.servicios, { comando: 'project.create', actor: sistema('cli'), datos: { nombre } });
      console.log(JSON.stringify({ proyecto_id: r.proyectoId }));
    } finally {
      await nucleo.detener();
    }
  },

  async 'ejecucion-real'() {
    const [proyectoId, accion, alcance, entrada] = args;
    if (!proyectoId || !accion || !alcance)
      throw new Error('Uso: ejecucion-real <proyectoId> <accion> <json-alcance> [json-entrada]');
    const nucleo = await arrancarNucleo(config, registroConsola);
    try {
      const r = await ejecutarComando(nucleo.servicios, {
        comando: 'run.request',
        actor: sistema('cli'),
        proyectoId,
        datos: { accion, alcance: JSON.parse(alcance) as unknown, entrada: entrada ? (JSON.parse(entrada) as unknown) : {} },
      });
      const estado = await esperarRun(r.entidadId);
      const run = await nucleo.servicios.db
        .selectFrom('ai_runs')
        .selectAll()
        .where('id', '=', r.entidadId)
        .executeTakeFirstOrThrow();
      console.log(JSON.stringify({ estado, run }, null, 2));
    } finally {
      await nucleo.detener();
    }
  },
};

ordenes['evaluar-clasificador'] = async () => {
  const particion = (args[0] ?? 'prueba') as Particion;
  await conBase(async (c) => {
    const informe = await evaluarClasificador({
      clasificador: crearClasificador(config),
      particion,
      tanda: 40,
      db: c.db,
      salida: 'evals/clasificador/resultados',
    });
    console.log(resumenEvaluacion(informe));
    console.log(`Resultado guardado en ${informe.archivo ?? '(sin archivo)'}`);
  });
};

ordenes['importar-diseno'] = async () => {
  const [proyectoId, dir = 'design'] = args;
  if (!proyectoId) throw new Error('Uso: importar-diseno <proyectoId> [dir]');
  const nucleo = await arrancarNucleo(config, registroConsola);
  try {
    const arbol = await leerArbol(dir);
    const r = await ejecutarComando(nucleo.servicios, {
      comando: 'design.import',
      actor: IMPORTADOR,
      proyectoId,
      datos: { arbol: Object.fromEntries(arbol), origen: dir },
    });
    console.log(JSON.stringify({ lote_id: r.entidadId, estado: r.estado, ...(r.resultado as object) }, null, 2));
  } finally {
    await nucleo.detener();
  }
};

ordenes['exportar-diseno'] = async () => {
  const [proyectoId, opcion, dir] = args;
  if (!proyectoId) throw new Error('Uso: exportar-diseno <proyectoId> [--comprobar dir | --salida dir]');
  await conBase(async (c) => {
    if (opcion === '--comprobar') {
      const difs = await compararExportacion(c.db, proyectoId, await leerArbol(dir ?? 'design'));
      if (difs.length > 0) {
        for (const d of difs) console.error(`✗ ${d}`);
        process.exitCode = 1;
        return;
      }
      console.log(`✓ La exportación coincide byte a byte con ${dir ?? 'design'}/.`);
      return;
    }
    const arbol = await exportarDiseno(c.db, proyectoId);
    await escribirArbol(dir ?? 'design-exportado', arbol);
    console.log(`Exportados ${arbol.size} archivo(s) en ${dir ?? 'design-exportado'}/.`);
  });
};

const accion = orden ? ordenes[orden] : undefined;
if (!accion) {
  console.error(`Órdenes: ${Object.keys(ordenes).join(', ')}`);
  process.exitCode = 2;
} else {
  try {
    await accion();
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}
