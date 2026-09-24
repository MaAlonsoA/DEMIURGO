// H1 preparado: importar el design/ real como lote pendiente, ratificarlo en un paso (solo una
// persona) y exportarlo sin diff. También AC-CON-001-10 (importador idempotente).

import { leerArbol, parsearDocumento, renderizarDocumento, validarArbol } from '@demiurgo/design';
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
    criterios: await contar('criteria'),
    enlaces: await contar('links'),
    taxonomias: await contar('taxonomies'),
    anexos: versiones.reduce((k, v) => k + (v.annexes as unknown[]).length, 0),
  };
}

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
