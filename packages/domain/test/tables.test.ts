import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
// El generador vive en el paquete design (depende de yaml); el dominio no puede importarlo.
import { RUTA_MODULO_TABLAS, generarModuloTablas } from '../../design/src/deriva.ts';
import { CAPACIDADES, TRANSICIONES } from '../src/generado/tablas.ts';
import {
  esquemaCapacidades,
  esquemaTransiciones,
  incoherenciasDeInvariantes,
  incoherenciasEstructurales,
  incoherenciasTablas,
  type TablaCapacidades,
  type TablaTransiciones,
} from '../src/tablas/esquemas.ts';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const leer = (ruta: string) => readFile(join(RAIZ, ruta), 'utf8');

type Comando = TablaCapacidades['comandos'][string];
type Entidad = TablaTransiciones['entidades'][string];

function comandoDe(cap: TablaCapacidades, nombre: string): Comando {
  const c = cap.comandos[nombre];
  if (!c) throw new Error(`No existe el comando ${nombre}.`);
  return c;
}

function entidadDe(tra: TablaTransiciones, nombre: string): Entidad {
  const e = tra.entidades[nombre];
  if (!e) throw new Error(`No existe la entidad ${nombre}.`);
  return e;
}

/** Tablas reales. AC-NUC-001-02 garantiza que el módulo generado es igual a design/datos/. */
function tablasReales(): { cap: TablaCapacidades; tra: TablaTransiciones } {
  return { cap: esquemaCapacidades.parse(CAPACIDADES), tra: esquemaTransiciones.parse(TRANSICIONES) };
}

/** Estados alcanzables desde «nuevo», calculado aquí aparte de `incoherenciasTablas`. */
function alcanzables(def: Entidad): Set<string> {
  const vistos = new Set<string>(['nuevo']);
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const t of def.transiciones) {
      const origenes = t.desde === 'nuevo' ? ['nuevo'] : t.desde;
      if (!vistos.has(t.hacia) && origenes.some((o) => vistos.has(o))) {
        vistos.add(t.hacia);
        cambio = true;
      }
    }
  }
  return vistos;
}

/** Tablas mínimas y coherentes: un documento que se crea y que solo una persona aprueba. */
function tablasMinimas(): { cap: TablaCapacidades; tra: TablaTransiciones } {
  return {
    cap: {
      codigo: 'DAT-CAP-001',
      version: 1,
      estado: 'propuesto',
      actores: { human: 'Persona.', agent_external: 'Agente externo.', agent_run: 'Ejecución.', system: 'Sistema.' },
      comandos: {
        'doc.create': { entidad: 'doc', permitido: ['human', 'agent_run'], decisivo: false, descripcion: 'Crear.' },
        'doc.approve': { entidad: 'doc', permitido: ['human'], decisivo: true, descripcion: 'Aprobar.' },
      },
      consultas: {},
    },
    tra: {
      codigo: 'DAT-TRA-001',
      version: 1,
      estado: 'propuesto',
      entidades: {
        doc: {
          etiqueta: 'Documento',
          implementado_en: 'S0',
          estados: { draft: 'Borrador', approved: 'Aprobado' },
          autoridad: ['approved'],
          transiciones: [
            { comando: 'doc.create', desde: 'nuevo', hacia: 'draft' },
            { comando: 'doc.approve', desde: ['draft'], hacia: 'approved' },
          ],
        },
      },
    },
  };
}

type Caso = { caso: string; romper: (cap: TablaCapacidades, tra: TablaTransiciones) => void; error: RegExp };

const INCOHERENTES: Caso[] = [
  {
    caso: 'un comando decisivo permitido a un agente',
    romper: (cap) => {
      comandoDe(cap, 'doc.approve').permitido = ['human', 'agent_run'];
    },
    error: /^doc\.approve: un comando decisivo solo puede estar permitido a «human»\.$/,
  },
  {
    caso: 'un estado de autoridad alcanzado con un comando no decisivo',
    romper: (cap) => {
      comandoDe(cap, 'doc.approve').decisivo = false;
    },
    error: /^doc\.approve: alcanza el estado de autoridad «approved» y debe ser decisivo\.$/,
  },
  {
    caso: 'un estado inalcanzable',
    romper: (_cap, tra) => {
      entidadDe(tra, 'doc').estados.archived = 'Archivado';
    },
    error: /^doc: el estado «archived» no es alcanzable\.$/,
  },
  {
    caso: 'un comando que no aparece en ninguna transición',
    romper: (cap) => {
      cap.comandos['doc.archive'] = { entidad: 'doc', permitido: ['human'], decisivo: false, descripcion: 'Archivar.' };
    },
    error: /^doc\.archive: el comando no aparece en ninguna transición\.$/,
  },
  {
    caso: 'una transición con un comando que no está en la matriz',
    romper: (_cap, tra) => {
      entidadDe(tra, 'doc').transiciones.push({ comando: 'doc.reopen', desde: ['approved'], hacia: 'draft' });
    },
    error: /^doc: el comando «doc\.reopen» no está en la matriz de capacidades\.$/,
  },
  {
    caso: 'un estado de autoridad que no existe',
    romper: (_cap, tra) => {
      entidadDe(tra, 'doc').autoridad.push('published');
    },
    error: /^doc: el estado de autoridad «published» no existe\.$/,
  },
  {
    caso: 'una transición hacia un estado que no existe',
    romper: (cap, tra) => {
      cap.comandos['doc.publish'] = { entidad: 'doc', permitido: ['human'], decisivo: false, descripcion: 'Publicar.' };
      entidadDe(tra, 'doc').transiciones.push({ comando: 'doc.publish', desde: ['draft'], hacia: 'published' });
    },
    error: /^doc: «doc\.publish» lleva a un estado inexistente «published»\.$/,
  },
  {
    caso: 'un comando decisivo que no alcanza ningún estado de autoridad',
    romper: (cap) => {
      const c = comandoDe(cap, 'doc.create');
      c.permitido = ['human'];
      c.decisivo = true;
    },
    error: /^doc\.create: es decisivo pero no alcanza ningún estado de autoridad\.$/,
  },
  {
    caso: 'una transición duplicada',
    romper: (_cap, tra) => {
      entidadDe(tra, 'doc').transiciones.push({ comando: 'doc.approve', desde: ['draft'], hacia: 'approved' });
    },
    error: /^doc: la transición «doc\.approve» desde «draft» está duplicada\.$/,
  },
  {
    caso: 'un comando asignado a otra entidad',
    romper: (cap) => {
      comandoDe(cap, 'doc.create').entidad = 'nota';
    },
    error: /^doc\.create: la matriz lo asigna a «nota», no a «doc»\.$/,
  },
];

describe('coherencia de las tablas', () => {
  it('AC-NUC-001-01 las tablas reales son coherentes', () => {
    const { cap, tra } = tablasReales();
    expect(incoherenciasTablas(cap, tra)).toEqual([]);
  });

  it('AC-NUC-001-01 en las tablas reales un comando decisivo solo lo ejecuta una persona', () => {
    const { cap } = tablasReales();
    const decisivos = Object.entries(cap.comandos).filter(([, c]) => c.decisivo);
    expect(decisivos.length).toBeGreaterThan(0);
    expect(decisivos.filter(([, c]) => c.permitido.join() !== 'human').map(([n]) => n)).toEqual([]);
  });

  it('AC-NUC-001-01 en las tablas reales los estados de autoridad solo se alcanzan con comandos decisivos', () => {
    const { cap, tra } = tablasReales();
    const haciaAutoridad = Object.values(tra.entidades).flatMap((def) =>
      def.transiciones.filter((t) => def.autoridad.includes(t.hacia)).map((t) => t.comando),
    );
    expect(haciaAutoridad.length).toBeGreaterThan(0);
    expect(haciaAutoridad.filter((c) => cap.comandos[c]?.decisivo !== true)).toEqual([]);
  });

  it('AC-NUC-001-01 en las tablas reales todos los estados son alcanzables y todo comando tiene transición', () => {
    const { cap, tra } = tablasReales();
    const inalcanzables = Object.entries(tra.entidades).flatMap(([nombre, def]) => {
      const vistos = alcanzables(def);
      return Object.keys(def.estados)
        .filter((e) => !vistos.has(e))
        .map((e) => `${nombre}.${e}`);
    });
    expect(inalcanzables).toEqual([]);
    const usados = new Set(Object.values(tra.entidades).flatMap((def) => def.transiciones.map((t) => t.comando)));
    expect(Object.keys(cap.comandos).filter((c) => !usados.has(c))).toEqual([]);
  });

  it('AC-NUC-001-01 permitir un comando decisivo real a un actor no humano se detecta siempre', () => {
    const { cap, tra } = tablasReales();
    const decisivos = Object.keys(cap.comandos).filter((c) => cap.comandos[c]?.decisivo);
    fc.assert(
      fc.property(
        fc.constantFrom(...decisivos),
        fc.subarray(['agent_external', 'agent_run', 'system'] as const, { minLength: 1 }),
        (comando, otros) => {
          const roto = structuredClone(cap);
          comandoDe(roto, comando).permitido = ['human', ...otros];
          expect(incoherenciasTablas(roto, tra)).toContain(
            `${comando}: un comando decisivo solo puede estar permitido a «human».`,
          );
        },
      ),
    );
  });

  it('AC-NUC-001-01 alcanzar un estado de autoridad real con un comando no decisivo se detecta siempre', () => {
    const { cap, tra } = tablasReales();
    const haciaAutoridad = Object.values(tra.entidades).flatMap((def) =>
      def.transiciones.filter((t) => def.autoridad.includes(t.hacia)).map((t) => ({ comando: t.comando, hacia: t.hacia })),
    );
    fc.assert(
      fc.property(fc.constantFrom(...haciaAutoridad), ({ comando, hacia }) => {
        const roto = structuredClone(cap);
        comandoDe(roto, comando).decisivo = false;
        expect(incoherenciasTablas(roto, tra)).toContain(
          `${comando}: alcanza el estado de autoridad «${hacia}» y debe ser decisivo.`,
        );
      }),
    );
  });

  it('AC-NUC-001-01 las tablas mínimas de referencia son coherentes', () => {
    const { cap, tra } = tablasMinimas();
    expect(incoherenciasEstructurales(cap, tra)).toEqual([]);
  });

  it.each(INCOHERENTES)('AC-NUC-001-01 detecta $caso', ({ romper, error }) => {
    const { cap, tra } = tablasMinimas();
    romper(cap, tra);
    expect(incoherenciasEstructurales(cap, tra)).toContainEqual(expect.stringMatching(error));
  });

  it('AC-NUC-001-01 las invariantes en código no se pueden relajar editando los datos', () => {
    const { cap, tra } = tablasReales();
    expect(incoherenciasDeInvariantes(cap, tra)).toEqual([]);
    const pregunta = tra.entidades.question;
    if (!pregunta) throw new Error('falta question');
    pregunta.autoridad = [];
    comandoDe(cap, 'record.create').permitido = ['human', 'agent_external'];
    const consulta = cap.consultas['query.tokens'];
    if (consulta) consulta.permitido = ['human', 'agent_external'];
    const errores = incoherenciasTablas(cap, tra);
    expect(errores).toContain('question: «confirmed» debe ser un estado de autoridad (I1).');
    expect(errores).toContain('record.create: un agent_external solo puede conversar, registrar fuentes y proponer (I2).');
    expect(errores).toContain('query.tokens: vedada a los agentes externos.');
  });
});

describe('deriva entre design/datos/ y el dominio', () => {
  const fuentes = async () => {
    const [cap, tra, generado] = await Promise.all([
      leer('design/datos/capacidades.yaml'),
      leer('design/datos/transiciones.yaml'),
      leer(RUTA_MODULO_TABLAS),
    ]);
    return { cap, tra, generado };
  };

  it('AC-NUC-001-02 regenerar desde design/datos/ da exactamente el módulo generado', async () => {
    const { cap, tra, generado } = await fuentes();
    expect(generarModuloTablas(cap, tra)).toBe(generado);
  });

  it('AC-NUC-001-02 un cambio en design/datos/ sin regenerar se detecta como deriva', async () => {
    const { cap, tra, generado } = await fuentes();
    const cambiada = cap.replace(/^version: (\d+)$/m, (_, n: string) => `version: ${Number(n) + 1}`);
    expect(cambiada).not.toBe(cap);
    expect(generarModuloTablas(cambiada, tra)).not.toBe(generado);
  });

  it('AC-NUC-001-02 la generación rechaza tablas incoherentes', async () => {
    const { cap, tra } = await fuentes();
    const rota = cap.replace(/^(\s+[a-z_.]+: \{[^}\n]*permitido: \[)human(\], decisivo: true)/m, '$1human, agent_run$2');
    expect(rota).not.toBe(cap);
    expect(() => generarModuloTablas(rota, tra)).toThrow(/Tablas incoherentes/);
  });
});
