// Acción design_proposal: a partir de una decisión aprobada, propone una FDR con sus AC como
// un paquete coherente que la persona acepta en un paso. El paquete depende de la versión
// vigente de la decisión: si cambia, queda obsoleto.

import { ErrorDominio } from '@demiurgo/domain';
import { registrarConstructor } from '../contexto/construir.ts';
import { conocimientoParaContexto } from '../contexto/conocimiento.ts';
import { registrarAplicador } from './aplicadores.ts';

const PRESUPUESTO = { decision: 8_000, relacionadas: 4_000, conocimiento: 4_000 };

registrarConstructor('design_proposal', async ({ trx, proyectoId, alcance, versionGrafo }) => {
  const v = await trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select([
      'records.id as recordId',
      'records.code',
      'records.type',
      'records.domain',
      'record_versions.n',
      'record_versions.state',
      'record_versions.title',
      'record_versions.sections',
    ])
    .where('record_versions.id', '=', alcance.id ?? '')
    .where('records.project_id', '=', proyectoId)
    .executeTakeFirst();
  if (!v) throw new ErrorDominio('no_encontrado', 'La versión de la decisión no existe.');
  if (v.type !== 'decision' || v.state !== 'approved') {
    throw new ErrorDominio('validacion', 'Solo se propone un diseño a partir de una decisión aprobada.');
  }
  const secciones = v.sections as { titulo: string; contenido: string }[];
  const texto = (t: string) => secciones.find((s) => s.titulo === t)?.contenido ?? '';
  const relacionadas = await trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.code', 'records.type', 'record_versions.n', 'record_versions.title'])
    .where('records.project_id', '=', proyectoId)
    .where('record_versions.state', '=', 'approved')
    .where('records.id', '<>', v.recordId)
    .orderBy('records.code')
    .limit(40)
    .execute();
  const conocimiento = await conocimientoParaContexto(
    trx,
    proyectoId,
    `${v.title} ${texto('Decisión')}`,
    PRESUPUESTO.conocimiento,
  );
  return {
    rol: 'disenar',
    constructor: 'design_proposal@1',
    presupuesto: PRESUPUESTO,
    version_grafo: versionGrafo,
    dependencias: [{ tipo: 'record', id: v.recordId, version: v.n }, ...conocimiento.dependencias],
    contenido: {
      decision: {
        codigo: v.code,
        version: v.n,
        dominio: v.domain,
        titulo: v.title,
        contexto: texto('Contexto').slice(0, 3000),
        decision: texto('Decisión').slice(0, 3000),
        consecuencias: texto('Consecuencias').slice(0, 2000),
      },
      registros_aprobados: relacionadas.map((r) => ({ codigo: r.code, tipo: r.type, version: r.n, titulo: r.title })),
      conocimiento: conocimiento.nodos,
    },
  };
});

registrarAplicador('design_proposal', async ({ trx, ejecutar, run, salida }) => {
  const pack = await trx
    .selectFrom('context_packs')
    .select(['content'])
    .where('id', '=', run.context_pack_id ?? '')
    .executeTakeFirstOrThrow();
  const d = (pack.content as { decision: { codigo: string; version: number; dominio: string } }).decision;
  const registro = await trx
    .selectFrom('records')
    .select('id')
    .where('project_id', '=', run.project_id)
    .where('code', '=', d.codigo)
    .executeTakeFirstOrThrow();
  const dependencia = { tipo: 'record' as const, id: registro.id, codigo: d.codigo, version: d.version };
  await ejecutar({
    proyectoId: run.project_id,
    comando: 'batch.submit',
    actor: { tipo: 'agent_run', run: run.id },
    datos: {
      resumen: `Diseño propuesto a partir de ${d.codigo} v${d.version}: FDR con ${salida.fdr.criterios.length} criterios.`,
      tipo_lote: 'system_package',
      resolucion: 'package',
      run_id: run.id,
      context_pack_id: run.context_pack_id ?? undefined,
      dependencias: [dependencia],
      propuestas: [
        { tipo: 'fdr', carga: { ...salida.fdr, basado_en: { codigo: d.codigo, version: d.version }, dominio: d.dominio } },
      ],
    },
  });
});
