import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
// El generador vive en el paquete design (depende de yaml); el dominio no puede importarlo.
import { TABLES_MODULE_PATH, generateTablesModule } from '../../design/src/derive.ts';
import { CAPABILITIES, TRANSITIONS } from '../src/generated/tables.ts';
import {
  capabilitiesSchema,
  transitionsSchema,
  invariantInconsistencies,
  structuralInconsistencies,
  tableInconsistencies,
  type CapabilitiesTable,
  type TransitionsTable,
} from '../src/tables/schemas.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string) => readFile(join(ROOT, path), 'utf8');

type Command = CapabilitiesTable['commands'][string];
type Entity = TransitionsTable['entities'][string];

function commandOf(cap: CapabilitiesTable, name: string): Command {
  const c = cap.commands[name];
  if (!c) throw new Error(`No existe el comando ${name}.`);
  return c;
}

function entityOf(trans: TransitionsTable, name: string): Entity {
  const e = trans.entities[name];
  if (!e) throw new Error(`No existe la entidad ${name}.`);
  return e;
}

/** Tablas reales. AC-NUC-001-02 garantiza que el módulo generado es igual a design/datos/. */
function realTables(): { cap: CapabilitiesTable; trans: TransitionsTable } {
  return { cap: capabilitiesSchema.parse(CAPABILITIES), trans: transitionsSchema.parse(TRANSITIONS) };
}

/** Estados alcanzables desde «nuevo», calculado aquí aparte de `incoherenciasTablas`. */
function reachable(def: Entity): Set<string> {
  const seen = new Set<string>(['new']);
  let change = true;
  while (change) {
    change = false;
    for (const t of def.transitions) {
      const origins = t.from === 'new' ? ['new'] : t.from;
      if (!seen.has(t.to) && origins.some((o) => seen.has(o))) {
        seen.add(t.to);
        change = true;
      }
    }
  }
  return seen;
}

/** Tablas mínimas y coherentes: un documento que se crea y que solo una persona aprueba. */
function minimalTables(): { cap: CapabilitiesTable; trans: TransitionsTable } {
  return {
    cap: {
      code: 'DAT-CAP-001',
      version: 1,
      state: 'proposed',
      actors: { human: 'Persona.', agent_external: 'Agente externo.', agent_run: 'Ejecución.', system: 'Sistema.' },
      commands: {
        'doc.create': { entity: 'doc', allowed: ['human', 'agent_run'], decisive: false, description: 'Crear.' },
        'doc.approve': { entity: 'doc', allowed: ['human'], decisive: true, description: 'Aprobar.' },
      },
      queries: {},
    },
    trans: {
      code: 'DAT-TRA-001',
      version: 1,
      state: 'proposed',
      entities: {
        doc: {
          label: 'Document',
          implemented_in: 'S0',
          states: { draft: 'Draft', approved: 'Approved' },
          authority: ['approved'],
          transitions: [
            { command: 'doc.create', from: 'new', to: 'draft' },
            { command: 'doc.approve', from: ['draft'], to: 'approved' },
          ],
        },
      },
    },
  };
}

type Case = { sample: string; corrupt: (cap: CapabilitiesTable, trans: TransitionsTable) => void; error: RegExp };

const INCONSISTENT: Case[] = [
  {
    sample: 'un comando decisivo permitido a un agente',
    corrupt: (cap) => {
      commandOf(cap, 'doc.approve').allowed = ['human', 'agent_run'];
    },
    error: /^doc\.approve: un comando decisivo solo puede estar permitido a «human»\.$/,
  },
  {
    sample: 'un estado de autoridad alcanzado con un comando no decisivo',
    corrupt: (cap) => {
      commandOf(cap, 'doc.approve').decisive = false;
    },
    error: /^doc\.approve: alcanza el estado de autoridad «approved» y debe ser decisivo\.$/,
  },
  {
    sample: 'un estado inalcanzable',
    corrupt: (_cap, trans) => {
      entityOf(trans, 'doc').states.archived = 'Archived';
    },
    error: /^doc: el estado «archived» no es alcanzable\.$/,
  },
  {
    sample: 'un comando que no aparece en ninguna transición',
    corrupt: (cap) => {
      cap.commands['doc.archive'] = { entity: 'doc', allowed: ['human'], decisive: false, description: 'Archivar.' };
    },
    error: /^doc\.archive: el comando no aparece en ninguna transición\.$/,
  },
  {
    sample: 'una transición con un comando que no está en la matriz',
    corrupt: (_cap, trans) => {
      entityOf(trans, 'doc').transitions.push({ command: 'doc.reopen', from: ['approved'], to: 'draft' });
    },
    error: /^doc: el comando «doc\.reopen» no está en la matriz de capacidades\.$/,
  },
  {
    sample: 'un estado de autoridad que no existe',
    corrupt: (_cap, trans) => {
      entityOf(trans, 'doc').authority.push('published');
    },
    error: /^doc: el estado de autoridad «published» no existe\.$/,
  },
  {
    sample: 'una transición hacia un estado que no existe',
    corrupt: (cap, trans) => {
      cap.commands['doc.publish'] = { entity: 'doc', allowed: ['human'], decisive: false, description: 'Publicar.' };
      entityOf(trans, 'doc').transitions.push({ command: 'doc.publish', from: ['draft'], to: 'published' });
    },
    error: /^doc: «doc\.publish» lleva a un estado inexistente «published»\.$/,
  },
  {
    sample: 'un comando decisivo que no alcanza ningún estado de autoridad',
    corrupt: (cap) => {
      const c = commandOf(cap, 'doc.create');
      c.allowed = ['human'];
      c.decisive = true;
    },
    error: /^doc\.create: es decisivo pero no alcanza ningún estado de autoridad\.$/,
  },
  {
    sample: 'una transición duplicada',
    corrupt: (_cap, trans) => {
      entityOf(trans, 'doc').transitions.push({ command: 'doc.approve', from: ['draft'], to: 'approved' });
    },
    error: /^doc: la transición «doc\.approve» desde «draft» está duplicada\.$/,
  },
  {
    sample: 'un comando asignado a otra entidad',
    corrupt: (cap) => {
      commandOf(cap, 'doc.create').entity = 'note';
    },
    error: /^doc\.create: la matriz lo asigna a «nota», no a «doc»\.$/,
  },
];

describe('coherencia de las tablas', () => {
  it('AC-NUC-001-01 las tablas reales son coherentes', () => {
    const { cap, trans } = realTables();
    expect(tableInconsistencies(cap, trans)).toEqual([]);
  });

  it('AC-NUC-001-01 en las tablas reales un comando decisivo solo lo ejecuta una persona', () => {
    const { cap } = realTables();
    const decisiveCommands = Object.entries(cap.commands).filter(([, c]) => c.decisive);
    expect(decisiveCommands.length).toBeGreaterThan(0);
    expect(decisiveCommands.filter(([, c]) => c.allowed.join() !== 'human').map(([n]) => n)).toEqual([]);
  });

  it('AC-NUC-001-01 en las tablas reales los estados de autoridad solo se alcanzan con comandos decisivos', () => {
    const { cap, trans } = realTables();
    const toAuthority = Object.values(trans.entities).flatMap((def) =>
      def.transitions.filter((t) => def.authority.includes(t.to)).map((t) => t.command),
    );
    expect(toAuthority.length).toBeGreaterThan(0);
    expect(toAuthority.filter((c) => cap.commands[c]?.decisive !== true)).toEqual([]);
  });

  it('AC-NUC-001-01 en las tablas reales todos los estados son alcanzables y todo comando tiene transición', () => {
    const { cap, trans } = realTables();
    const unreachable = Object.entries(trans.entities).flatMap(([name, def]) => {
      const seen = reachable(def);
      return Object.keys(def.states)
        .filter((e) => !seen.has(e))
        .map((e) => `${name}.${e}`);
    });
    expect(unreachable).toEqual([]);
    const used = new Set(Object.values(trans.entities).flatMap((def) => def.transitions.map((t) => t.command)));
    expect(Object.keys(cap.commands).filter((c) => !used.has(c))).toEqual([]);
  });

  it('AC-NUC-001-01 permitir un comando decisivo real a un actor no humano se detecta siempre', () => {
    const { cap, trans } = realTables();
    const decisiveCommands = Object.keys(cap.commands).filter((c) => cap.commands[c]?.decisive);
    fc.assert(
      fc.property(
        fc.constantFrom(...decisiveCommands),
        fc.subarray(['agent_external', 'agent_run', 'system'] as const, { minLength: 1 }),
        (command, other) => {
          const broken = structuredClone(cap);
          commandOf(broken, command).allowed = ['human', ...other];
          expect(tableInconsistencies(broken, trans)).toContain(
            `${command}: un comando decisivo solo puede estar permitido a «human».`,
          );
        },
      ),
    );
  });

  it('AC-NUC-001-01 alcanzar un estado de autoridad real con un comando no decisivo se detecta siempre', () => {
    const { cap, trans } = realTables();
    const toAuthority = Object.values(trans.entities).flatMap((def) =>
      def.transitions.filter((t) => def.authority.includes(t.to)).map((t) => ({ command: t.command, to: t.to })),
    );
    fc.assert(
      fc.property(fc.constantFrom(...toAuthority), ({ command, to }) => {
        const broken = structuredClone(cap);
        commandOf(broken, command).decisive = false;
        expect(tableInconsistencies(broken, trans)).toContain(
          `${command}: alcanza el estado de autoridad «${to}» y debe ser decisivo.`,
        );
      }),
    );
  });

  it('AC-NUC-001-01 las tablas mínimas de referencia son coherentes', () => {
    const { cap, trans } = minimalTables();
    expect(structuralInconsistencies(cap, trans)).toEqual([]);
  });

  it.each(INCONSISTENT)('AC-NUC-001-01 detecta $caso', ({ corrupt, error }) => {
    const { cap, trans } = minimalTables();
    corrupt(cap, trans);
    expect(structuralInconsistencies(cap, trans)).toContainEqual(expect.stringMatching(error));
  });

  it('AC-NUC-001-01 las invariantes en código no se pueden relajar editando los datos', () => {
    const { cap, trans } = realTables();
    expect(invariantInconsistencies(cap, trans)).toEqual([]);
    const question = trans.entities.question;
    if (!question) throw new Error('falta question');
    question.authority = [];
    commandOf(cap, 'record.create').allowed = ['human', 'agent_external'];
    const queryName = cap.queries['query.tokens'];
    if (queryName) queryName.allowed = ['human', 'agent_external'];
    const errors = tableInconsistencies(cap, trans);
    expect(errors).toContain('question: «confirmed» debe ser un estado de autoridad (I1).');
    expect(errors).toContain('record.create: un agent_external solo puede conversar, registrar fuentes y proponer (I2).');
    expect(errors).toContain('query.tokens: vedada a los agentes externos.');
  });
});

describe('deriva entre design/data/ y el dominio', () => {
  const sources = async () => {
    const [cap, trans, generated] = await Promise.all([
      read('design/data/capabilities.yaml'),
      read('design/data/transitions.yaml'),
      read(TABLES_MODULE_PATH),
    ]);
    return { cap, trans, generated };
  };

  it('AC-NUC-001-02 regenerar desde design/data/ da exactamente el módulo generado', async () => {
    const { cap, trans, generated } = await sources();
    expect(generateTablesModule(cap, trans)).toBe(generated);
  });

  it('AC-NUC-001-02 un cambio en design/data/ sin regenerar se detecta como deriva', async () => {
    const { cap, trans, generated } = await sources();
    const changed = cap.replace(/^version: (\d+)$/m, (_, n: string) => `version: ${Number(n) + 1}`);
    expect(changed).not.toBe(cap);
    expect(generateTablesModule(changed, trans)).not.toBe(generated);
  });

  it('AC-NUC-001-02 la generación rechaza tablas incoherentes', async () => {
    const { cap, trans } = await sources();
    const brokenText = cap.replace(/^(\s+[a-z_.]+: \{[^}\n]*permitido: \[)human(\], decisivo: true)/m, '$1human, agent_run$2');
    expect(brokenText).not.toBe(cap);
    expect(() => generateTablesModule(brokenText, trans)).toThrow(/Tablas incoherentes/);
  });
});
