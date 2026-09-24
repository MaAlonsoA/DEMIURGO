import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HALLAZGOS_IDEA, VEREDICTOS } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import { crearClasificadorSimulado } from '../src/clasificador/simulado.ts';
import { evaluarClasificador } from '../src/conocimiento/evaluar.ts';
import { usarEntorno } from './soporte/entorno.ts';

const entorno = usarEntorno();

describe('evaluación del clasificador', () => {
  it('AC-CON-001-11 registra precisión y cobertura por veredicto y por hallazgo en un archivo y en la tabla', async () => {
    const salida = await mkdtemp(join(tmpdir(), 'dmg-eval-'));
    try {
      const informe = await evaluarClasificador({
        clasificador: crearClasificadorSimulado(),
        particion: 'prueba',
        db: entorno().servicios.db,
        salida,
      });
      expect(informe.veredictos.total).toBeGreaterThanOrEqual(30);
      expect(informe.ideas.total).toBeGreaterThanOrEqual(20);
      for (const v of VEREDICTOS) {
        expect(informe.veredictos.porClase[v]).toMatchObject({ precision: expect.any(Number), cobertura: expect.any(Number) });
      }
      for (const h of HALLAZGOS_IDEA) expect(informe.ideas.porClase[h]).toHaveProperty('cobertura');
      const archivo = JSON.parse(await readFile(informe.archivo ?? '', 'utf8')) as { veredictos: { exactitud: number } };
      expect(archivo.veredictos.exactitud).toBe(informe.veredictos.exactitud);
      const filas = await entorno()
        .servicios.db.selectFrom('classifier_evaluations')
        .selectAll()
        .where('classifier', '=', 'simulado@1')
        .execute();
      expect(filas.map((f) => f.task).sort()).toEqual(['ideas', 'veredictos']);
    } finally {
      await rm(salida, { recursive: true, force: true });
    }
  });

  it('AC-CLA-001-02 el simulador da la misma respuesta para la misma entrada', async () => {
    const a = await evaluarClasificador({ clasificador: crearClasificadorSimulado(), particion: 'desarrollo' });
    const b = await evaluarClasificador({ clasificador: crearClasificadorSimulado(), particion: 'desarrollo' });
    expect(b.respuestas).toEqual(a.respuestas);
  });
});
