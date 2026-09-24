// H1 preparado: importar el design/ real como lote pendiente, ratificarlo en un paso (solo una
// persona) y exportarlo sin diff. También AC-CON-001-10 (importador idempotente).

import {
  type Documento,
  type DocumentoRegistro,
  leerArbol,
  parsearDocumento,
  renderizarDocumento,
  validarArbol,
} from '@demiurgo/design';
import { type Actor, agenteExterno, agenteRun, humano, sistema } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { ejecutarComando } from '../src/bus/bus.ts';
import { compararExportacion, exportarDiseno } from '../src/diseno/exportar.ts';
import { IMPORTADOR, recuentosDelArbol } from '../src/diseno/importar.ts';
import type { Servicios } from '../src/servicios.ts';
import { usarEntorno } from './soporte/entorno.ts';

const entorno = usarEntorno();
const ana = humano('ana');
let s: Servicios;
let arbol: Map<string, string>;

beforeAll(async () => {
  s = entorno().servicios;
  arbol = await leerArbol('design');
});

async function proyecto(nombre: string): Promise<string> {
  return (await ejecutarComando(s, { comando: 'project.create', actor: sistema('cli'), datos: { nombre } })).proyectoId;
}

const importar = (proyectoId: string, a: Map<string, string> = arbol) =>
  ejecutarComando(s, {
    comando: 'design.import',
    actor: IMPORTADOR,
    proyectoId,
    datos: { arbol: Object.fromEntries(a), origen: 'prueba' },
  });

const ratificar = (proyectoId: string, loteId: string, actor: Actor = ana) =>
  ejecutarComando(s, { comando: 'batch.accept_package', actor, proyectoId, entidadId: loteId, datos: {} });

async function recuentosEnBase(proyectoId: string) {
  const registros = await s.db.selectFrom('records').select('type').where('project_id', '=', proyectoId).execute();
  const n = (t: string) => registros.filter((r) => r.type === t).length;
  const contar = async (tabla: 'criteria' | 'links' | 'taxonomies') =>
    Number(
      (
        await s.db
          .selectFrom(tabla)
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('project_id', '=', proyectoId)
          .executeTakeFirstOrThrow()
      ).n,
    );
  const versiones = await s.db.selectFrom('record_versions').select('annexes').where('project_id', '=', proyectoId).execute();
  return {
    decision: n('decision'),
    adr: n('adr'),
    fdr: n('fdr'),
    bug: n('bug'),
    versiones: versiones.length,
    criterios: await contar('criteria'),
    enlaces: await contar('links'),
    taxonomias: await contar('taxonomies'),
    anexos: versiones.reduce((k, v) => k + (v.annexes as unknown[]).length, 0),
  };
}

/** Copia del árbol con un documento cambiado. */
function editar(base: Map<string, string>, ruta: string, cambio: (d: Documento) => Documento): Map<string, string> {
  const r = parsearDocumento(base.get(ruta) ?? '', ruta);
  if (!r.ok) throw new Error(`${ruta} no es válido`);
  const m = new Map(base);
  m.set(ruta, renderizarDocumento(cambio(r.valor)));
  return m;
}

const comoRegistro = (d: Documento) => d as DocumentoRegistro;

describe('importación de design/ (H1)', () => {
  it('AC-AUT-001-01 la importación crea un lote pendiente con los mismos recuentos que el origen y nada aprobado', async () => {
    const p = await proyecto('H1 recuentos');
    const r = await importar(p);
    const informe = validarArbol(arbol);
    const esperados = recuentosDelArbol(informe.registros, informe.taxonomias);
    expect(r.resultado).toMatchObject({ recuentos: esperados, propuestas: informe.registros.length + informe.taxonomias.length });
    const lote = await s.db.selectFrom('proposal_batches').selectAll().where('id', '=', r.entidadId).executeTakeFirstOrThrow();
    expect(lote).toMatchObject({ kind: 'import', resolution_mode: 'package', state: 'pending', producer: 'system:importador@1' });
    // Nada existe todavía como autoridad.
    expect(await s.db.selectFrom('records').select('id').where('project_id', '=', p).execute()).toHaveLength(0);
    expect(
      await s.db.selectFrom('record_versions').select('id').where('project_id', '=', p).where('state', '=', 'approved').execute(),
    ).toHaveLength(0);
  });

  it('AC-CON-001-10 importar dos veces design/ no duplica', async () => {
    const p = await proyecto('H1 idempotente');
    const a = await importar(p);
    const b = await importar(p);
    expect(b.entidadId).toBe(a.entidadId);
    expect(b.resultado).toMatchObject({ repetida: true });
    const lotes = await s.db.selectFrom('proposal_batches').select('id').where('project_id', '=', p).execute();
    const propuestas = await s.db.selectFrom('proposals').select('id').where('project_id', '=', p).execute();
    expect(lotes).toHaveLength(1);
    expect(propuestas).toHaveLength(validarArbol(arbol).registros.length + validarArbol(arbol).taxonomias.length);
  });

  it('AC-AUT-001-02 ratificar con un actor no humano da 403 sin efectos', async () => {
    const p = await proyecto('H1 solo persona');
    const r = await importar(p);
    const eventos = async () => (await s.db.selectFrom('events').select('id').where('project_id', '=', p).execute()).length;
    const antes = await eventos();
    for (const actor of [
      agenteExterno('claude-code', 's'),
      agenteRun('00000000-0000-7000-8000-000000000009'),
      sistema('importador'),
    ]) {
      await expect(ratificar(p, r.entidadId, actor)).rejects.toMatchObject({ tipo: 'prohibido' });
    }
    expect(await eventos()).toBe(antes);
    expect(await s.db.selectFrom('records').select('id').where('project_id', '=', p).execute()).toHaveLength(0);
  });

  it('AC-AUT-001-03 ratificar en un paso crea todo con los estados del origen y la persona como actor', async () => {
    const p = await proyecto('H1 ratificar');
    const r = await importar(p);
    await ratificar(p, r.entidadId);
    const informe = validarArbol(arbol);
    expect(await recuentosEnBase(p)).toEqual(recuentosDelArbol(informe.registros, informe.taxonomias));
    // Todo el design/ de D0 está «propuesto»: las versiones quedan en borrador.
    const estados = await s.db.selectFrom('record_versions').select('state').where('project_id', '=', p).execute();
    expect(new Set(estados.map((e) => e.state))).toEqual(new Set(['draft']));
    const actores = await s.db
      .selectFrom('events')
      .select(['command', 'actor'])
      .where('project_id', '=', p)
      .where('command', 'in', [
        'batch.accept_package',
        'proposal.accept',
        'record.create',
        'record_version.create',
        'criterion.record',
        'link.create',
        'taxonomy.propose',
      ])
      .execute();
    expect(actores.length).toBeGreaterThan(20);
    expect(actores.every((e) => e.actor === 'human:ana')).toBe(true);
    const lote = await s.db
      .selectFrom('proposal_batches')
      .select('state')
      .where('id', '=', r.entidadId)
      .executeTakeFirstOrThrow();
    expect(lote.state).toBe('accepted');
  });

  it('AC-AUT-001-04 tras ratificar, la exportación coincide byte a byte con design/', async () => {
    const p = await proyecto('H1 exportar');
    await ratificar(p, (await importar(p)).entidadId);
    expect(await compararExportacion(s.db, p, arbol)).toEqual([]);
    const exportado = await exportarDiseno(s.db, p);
    expect([...exportado.keys()].sort()).toEqual([...arbol.keys()].sort());
  });

  it('AC-AUT-001-04 con documentos aprobados en el origen, se aprueban al ratificar y la exportación sigue sin diff', async () => {
    const p = await proyecto('H1 aprobados');
    // Simula el merge de la persona: aprueba la decisión y la taxonomía editando su estado.
    const aprobado = new Map(arbol);
    for (const ruta of ['decisiones/DEC-PLN-001.md', 'taxonomia/TAX-001.md']) {
      const doc = parsearDocumento(arbol.get(ruta) ?? '', ruta);
      if (!doc.ok) throw new Error('documento inválido');
      aprobado.set(ruta, renderizarDocumento({ ...doc.valor, estado: 'aprobado' }));
    }
    await ratificar(p, (await importar(p, aprobado)).entidadId);
    const dec = await s.db
      .selectFrom('record_versions')
      .innerJoin('records', 'records.id', 'record_versions.record_id')
      .select(['record_versions.state', 'record_versions.approved_by'])
      .where('records.project_id', '=', p)
      .where('records.code', '=', 'DEC-PLN-001')
      .executeTakeFirstOrThrow();
    expect(dec).toEqual({ state: 'approved', approved_by: 'human:ana' });
    const tax = await s.db
      .selectFrom('taxonomies')
      .select(['state', 'approved_by'])
      .where('project_id', '=', p)
      .executeTakeFirstOrThrow();
    expect(tax).toEqual({ state: 'approved', approved_by: 'human:ana' });
    expect(await compararExportacion(s.db, p, aprobado)).toEqual([]);
  });

  it('AC-AUT-001-05 importar de nuevo tras ratificar no crea nada', async () => {
    const p = await proyecto('H1 reimportar');
    const r = await importar(p);
    await ratificar(p, r.entidadId);
    const antes = await recuentosEnBase(p);
    const otra = await importar(p);
    expect(otra.entidadId).toBe(r.entidadId);
    expect(otra.resultado).toMatchObject({ repetida: true, estado: 'accepted' });
    expect(await recuentosEnBase(p)).toEqual(antes);
    expect(
      await s.db.selectFrom('proposal_batches').select('id').where('project_id', '=', p).where('kind', '=', 'import').execute(),
    ).toHaveLength(1);
  });
});

describe('reimportación y diseño en la v2 (revisión de H1)', () => {
  const FDR = 'fdr/FDR-AUT-001.md';

  it('AC-AUT-001-05 un cambio sin subir la versión se rechaza nombrando el documento; subiéndola se propone solo ese', async () => {
    const p = await proyecto('H1 cambio sin versión');
    await ratificar(p, (await importar(p)).entidadId);
    // Un enlace nuevo en la misma versión: la huella del contenido no bastaba para verlo.
    const conEnlace = (d: Documento) => {
      const r = comoRegistro(d);
      return {
        ...r,
        enlaces: [...r.enlaces, { tipo: 'conflicts_with' as const, destino: { codigo: 'ADR-FMT-001', version: 1 } }],
      };
    };
    await expect(importar(p, editar(arbol, FDR, conEnlace))).rejects.toMatchObject({
      tipo: 'guarda',
      motivos: [`${FDR}: la versión 1 ya está en la v2 con otro contenido; sube la versión y añade nota_de_cambio.`],
    });
    const v2 = editar(arbol, FDR, (d) => ({ ...conEnlace(d), version: 2, notaDeCambio: 'Enlaza con el formato.' }));
    const r = await importar(p, v2);
    expect(r.resultado).toMatchObject({ propuestas: 1 });
    await ratificar(p, r.entidadId);
    expect(await compararExportacion(s.db, p, v2)).toEqual([]);
  });

  it('AC-AUT-001-05 un cambio solo de estado, también de la taxonomía, se ratifica y la exportación coincide', async () => {
    const p = await proyecto('H1 solo estado');
    await ratificar(p, (await importar(p)).entidadId);
    let aprobado = arbol;
    for (const ruta of ['decisiones/DEC-PLN-001.md', 'taxonomia/TAX-001.md']) {
      aprobado = editar(aprobado, ruta, (d) => ({ ...d, estado: 'aprobado' }));
    }
    const r = await importar(p, aprobado);
    expect(r.resultado).toMatchObject({ propuestas: 2 });
    await ratificar(p, r.entidadId);
    const tax = await s.db.selectFrom('taxonomies').select('state').where('project_id', '=', p).execute();
    expect(tax.map((t) => t.state)).toEqual(['approved']);
    expect(await compararExportacion(s.db, p, aprobado)).toEqual([]);
  });

  it('AC-AUT-001-04 una versión nueva aprobada en la v2 deja una exportación válida que, reimportada, no propone nada', async () => {
    const p = await proyecto('H1 versión en la v2');
    await ratificar(p, (await importar(p)).entidadId);
    const dec = await s.db
      .selectFrom('records')
      .select('id')
      .where('project_id', '=', p)
      .where('code', '=', 'DEC-PLN-001')
      .executeTakeFirstOrThrow();
    const original = parsearDocumento(arbol.get('decisiones/DEC-PLN-001.md') ?? '', 'dec');
    if (!original.ok) throw new Error('DEC-PLN-001 no es válido');
    const nueva = await ejecutarComando(s, {
      comando: 'record_version.create',
      actor: ana,
      proyectoId: p,
      datos: {
        record_id: dec.id,
        titulo: original.valor.titulo,
        secciones: original.valor.secciones,
        nota_de_cambio: 'Se revisa el plan.',
      },
    });
    await ejecutarComando(s, {
      comando: 'record_version.approve',
      actor: ana,
      proyectoId: p,
      entidadId: nueva.entidadId,
      datos: {},
    });
    const exportado = await exportarDiseno(s.db, p);
    expect(validarArbol(exportado).problemas).toEqual([]);
    // Los documentos que se basan en DEC-PLN-001 siguen en su versión 1 hasta que la persona revise el enlace.
    expect(exportado.get(FDR)).toContain('destino: DEC-PLN-001@1');
    await expect(importar(p, exportado)).rejects.toMatchObject({ tipo: 'conflicto' });
  });

  it('AC-AUT-001-04 un registro creado en la v2 no comparte DOM-NNN con otro tipo: la exportación sigue siendo válida', async () => {
    const p = await proyecto('H1 códigos');
    await ratificar(p, (await importar(p)).entidadId);
    const fdr = {
      tipo: 'fdr',
      dominio: 'nucleo',
      titulo: 'El núcleo del Pilar 2',
      secciones: [
        { titulo: 'Objetivo', contenido: 'o' },
        { titulo: 'Alcance', contenido: 'a' },
        { titulo: 'Fuera de alcance', contenido: 'f' },
        { titulo: 'Comportamiento', contenido: 'c' },
      ],
      criterios: [
        {
          arrastre: 'new',
          titulo: 'Tareas',
          enunciado: 'Cuando se crea una tarea, entonces cubre un AC.',
          verificacion: 'automatic',
          comprobacion: 'Prueba.',
        },
      ],
    };
    const r = await ejecutarComando(s, { comando: 'record.create', actor: ana, proyectoId: p, datos: fdr });
    // ADR-NUC-001 ya existe: la FDR del mismo dominio recibe el siguiente número de NUC.
    expect((r.resultado as { codigo: string }).codigo).toBe('FDR-NUC-002');
    await expect(
      ejecutarComando(s, { comando: 'record.create', actor: ana, proyectoId: p, datos: { ...fdr, codigo: 'FDR-NUC-001' } }),
    ).rejects.toMatchObject({
      tipo: 'guarda',
      motivos: ['FDR-NUC-001 comparte NUC-001 con ADR-NUC-001: la parte DOM-NNN de un código es única entre tipos.'],
    });
    expect(validarArbol(await exportarDiseno(s.db, p)).problemas).toEqual([]);
  });

  it('AC-AUT-001-04 un criterio con «Deriva de» sobrevive a la ida y vuelta', async () => {
    const p = await proyecto('H1 deriva de');
    const conDerivado = editar(arbol, FDR, (d) => {
      const r = comoRegistro(d);
      const nuevo = {
        codigo: 'AC-AUT-001-09',
        titulo: 'Reimportación sin efectos',
        verificacion: 'automática' as const,
        comprobacion: 'Se reimporta tras ratificar.',
        enunciado: 'Dado design/ ratificado, cuando se importa otra vez, entonces no se crea nada.',
        derivaDe: 'AC-CON-001-10',
      };
      return { ...r, criterios: [...r.criterios, nuevo] };
    });
    expect(validarArbol(conDerivado).problemas).toEqual([]);
    await ratificar(p, (await importar(p, conDerivado)).entidadId);
    expect(await compararExportacion(s.db, p, conDerivado)).toEqual([]);
  });

  it('AC-AUT-001-01 una importación nueva deja obsoleta la que seguía pendiente', async () => {
    const p = await proyecto('H1 dos importaciones');
    const primera = await importar(p);
    const segunda = await importar(
      p,
      editar(arbol, 'decisiones/DEC-PLN-001.md', (d) => ({ ...d, estado: 'aprobado' })),
    );
    const estado = async (id: string) =>
      (await s.db.selectFrom('proposal_batches').select('state').where('id', '=', id).executeTakeFirstOrThrow()).state;
    expect(await estado(primera.entidadId)).toBe('superseded');
    expect(await estado(segunda.entidadId)).toBe('pending');
    await ratificar(p, segunda.entidadId);
  });

  it('AC-AUT-001-01 una persona puede importar: el importador produce el lote y ella queda en el evento', async () => {
    const p = await proyecto('H1 importa una persona');
    const r = await ejecutarComando(s, {
      comando: 'design.import',
      actor: ana,
      proyectoId: p,
      datos: { arbol: Object.fromEntries(arbol) },
    });
    const lote = await s.db
      .selectFrom('proposal_batches')
      .select('producer')
      .where('id', '=', r.entidadId)
      .executeTakeFirstOrThrow();
    expect(lote.producer).toBe('system:importador@1');
    const evento = await s.db
      .selectFrom('events')
      .select('actor')
      .where('command', '=', 'design.import')
      .where('entity_id', '=', r.entidadId)
      .executeTakeFirstOrThrow();
    expect(evento.actor).toBe('human:ana');
  });

  it('AC-AUT-001-02 solo la importación propone documentos importados', async () => {
    const p = await proyecto('H1 tipos importados');
    const informe = validarArbol(arbol);
    const documento = { ...informe.registros[0], anexosContenido: [] };
    for (const actor of [sistema('prueba'), sistema('conocimiento')]) {
      await expect(
        ejecutarComando(s, {
          comando: 'batch.submit',
          actor,
          proyectoId: p,
          datos: { propuestas: [{ tipo: 'registro_importado', carga: { documento, ruta: 'x' } }] },
        }),
      ).rejects.toMatchObject({
        tipo: 'guarda',
        motivos: expect.arrayContaining(['Solo la importación de design/ propone «registro_importado».']),
      });
    }
  });
});
