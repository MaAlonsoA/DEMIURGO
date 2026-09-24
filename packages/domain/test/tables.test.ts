import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
// The generator lives in the design package (it depends on yaml); the domain can't import it.
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
  if (!c) throw new Error(`Command ${name} does not exist.`);
  return c;
}

function entityOf(trans: TransitionsTable, name: string): Entity {
  const e = trans.entities[name];
  if (!e) throw new Error(`Entity ${name} does not exist.`);
  return e;
}

/** Real tables. AC-NUC-001-02 guarantees that the generated module equals design/data/. */
function realTables(): { cap: CapabilitiesTable; trans: TransitionsTable } {
  return { cap: capabilitiesSchema.parse(CAPABILITIES), trans: transitionsSchema.parse(TRANSITIONS) };
}

/** States reachable from "new", computed here separately from `tableInconsistencies`. */
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

/** Minimal, consistent tables: a document that gets created and only a person approves. */
function minimalTables(): { cap: CapabilitiesTable; trans: TransitionsTable } {
  return {
    cap: {
      code: 'DAT-CAP-001',
      version: 1,
      state: 'proposed',
      actors: { human: 'Person.', agent_external: 'External agent.', agent_run: 'Run.', system: 'System.' },
      commands: {
        'doc.create': { entity: 'doc', allowed: ['human', 'agent_run'], decisive: false, description: 'Create.' },
        'doc.approve': { entity: 'doc', allowed: ['human'], decisive: true, description: 'Approve.' },
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
    sample: 'a decisive command allowed for an agent',
    corrupt: (cap) => {
      commandOf(cap, 'doc.approve').allowed = ['human', 'agent_run'];
    },
    error: /^doc\.approve: a decisive command can only be allowed for "human"\.$/,
  },
  {
    sample: 'an authority state reached with a non-decisive command',
    corrupt: (cap) => {
      commandOf(cap, 'doc.approve').decisive = false;
    },
    error: /^doc\.approve: reaches authority state "approved" and must be decisive\.$/,
  },
  {
    sample: 'an unreachable state',
    corrupt: (_cap, trans) => {
      entityOf(trans, 'doc').states.archived = 'Archived';
    },
    error: /^doc: state "archived" is not reachable\.$/,
  },
  {
    sample: 'a command that does not appear in any transition',
    corrupt: (cap) => {
      cap.commands['doc.archive'] = { entity: 'doc', allowed: ['human'], decisive: false, description: 'Archive.' };
    },
    error: /^doc\.archive: command does not appear in any transition\.$/,
  },
  {
    sample: 'a transition with a command that is not in the matrix',
    corrupt: (_cap, trans) => {
      entityOf(trans, 'doc').transitions.push({ command: 'doc.reopen', from: ['approved'], to: 'draft' });
    },
    error: /^doc: command "doc\.reopen" is not in the capabilities matrix\.$/,
  },
  {
    sample: 'an authority state that does not exist',
    corrupt: (_cap, trans) => {
      entityOf(trans, 'doc').authority.push('published');
    },
    error: /^doc: authority state "published" does not exist\.$/,
  },
  {
    sample: 'a transition to a state that does not exist',
    corrupt: (cap, trans) => {
      cap.commands['doc.publish'] = { entity: 'doc', allowed: ['human'], decisive: false, description: 'Publish.' };
      entityOf(trans, 'doc').transitions.push({ command: 'doc.publish', from: ['draft'], to: 'published' });
    },
    error: /^doc: "doc\.publish" leads to a nonexistent state "published"\.$/,
  },
  {
    sample: 'a decisive command that does not reach any authority state',
    corrupt: (cap) => {
      const c = commandOf(cap, 'doc.create');
      c.allowed = ['human'];
      c.decisive = true;
    },
    error: /^doc\.create: is decisive but does not reach any authority state\.$/,
  },
  {
    sample: 'a duplicated transition',
    corrupt: (_cap, trans) => {
      entityOf(trans, 'doc').transitions.push({ command: 'doc.approve', from: ['draft'], to: 'approved' });
    },
    error: /^doc: transition "doc\.approve" from "draft" is duplicated\.$/,
  },
  {
    sample: 'a command assigned to another entity',
    corrupt: (cap) => {
      commandOf(cap, 'doc.create').entity = 'note';
    },
    error: /^doc\.create: the matrix assigns it to "note", not to "doc"\.$/,
  },
];

describe('consistency of the tables', () => {
  it('AC-NUC-001-01 the real tables are consistent', () => {
    const { cap, trans } = realTables();
    expect(tableInconsistencies(cap, trans)).toEqual([]);
  });

  it('AC-NUC-001-01 in the real tables a decisive command is only run by a person', () => {
    const { cap } = realTables();
    const decisiveCommands = Object.entries(cap.commands).filter(([, c]) => c.decisive);
    expect(decisiveCommands.length).toBeGreaterThan(0);
    expect(decisiveCommands.filter(([, c]) => c.allowed.join() !== 'human').map(([n]) => n)).toEqual([]);
  });

  it('AC-NUC-001-01 in the real tables authority states are only reached with decisive commands', () => {
    const { cap, trans } = realTables();
    const toAuthority = Object.values(trans.entities).flatMap((def) =>
      def.transitions.filter((t) => def.authority.includes(t.to)).map((t) => t.command),
    );
    expect(toAuthority.length).toBeGreaterThan(0);
    expect(toAuthority.filter((c) => cap.commands[c]?.decisive !== true)).toEqual([]);
  });

  it('AC-NUC-001-01 in the real tables every state is reachable and every command has a transition', () => {
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

  it('AC-NUC-001-01 allowing a real decisive command to a non-human actor is always detected', () => {
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
            `${command}: a decisive command can only be allowed for "human".`,
          );
        },
      ),
    );
  });

  it('AC-NUC-001-01 reaching a real authority state with a non-decisive command is always detected', () => {
    const { cap, trans } = realTables();
    const toAuthority = Object.values(trans.entities).flatMap((def) =>
      def.transitions.filter((t) => def.authority.includes(t.to)).map((t) => ({ command: t.command, to: t.to })),
    );
    fc.assert(
      fc.property(fc.constantFrom(...toAuthority), ({ command, to }) => {
        const broken = structuredClone(cap);
        commandOf(broken, command).decisive = false;
        expect(tableInconsistencies(broken, trans)).toContain(
          `${command}: reaches authority state "${to}" and must be decisive.`,
        );
      }),
    );
  });

  it('AC-NUC-001-01 the minimal reference tables are consistent', () => {
    const { cap, trans } = minimalTables();
    expect(structuralInconsistencies(cap, trans)).toEqual([]);
  });

  it.each(INCONSISTENT)('AC-NUC-001-01 detects $sample', ({ corrupt, error }) => {
    const { cap, trans } = minimalTables();
    corrupt(cap, trans);
    expect(structuralInconsistencies(cap, trans)).toContainEqual(expect.stringMatching(error));
  });

  it("AC-NUC-001-01 the invariants fixed in code can't be relaxed by editing the data", () => {
    const { cap, trans } = realTables();
    expect(invariantInconsistencies(cap, trans)).toEqual([]);
    const question = trans.entities.question;
    if (!question) throw new Error('question is missing');
    question.authority = [];
    commandOf(cap, 'record.create').allowed = ['human', 'agent_external'];
    const queryDef = cap.queries['query.tokens'];
    if (queryDef) queryDef.allowed = ['human', 'agent_external'];
    const errors = tableInconsistencies(cap, trans);
    expect(errors).toContain('question: "confirmed" must be an authority state (I1).');
    expect(errors).toContain(
      'record.create: an actor of type agent_external can only converse, register sources and propose (I2).',
    );
    expect(errors).toContain('query.tokens: forbidden to external agents.');
  });
});

describe('drift between design/data/ and the domain', () => {
  const sources = async () => {
    const [cap, trans, generated] = await Promise.all([
      read('design/data/capabilities.yaml'),
      read('design/data/transitions.yaml'),
      read(TABLES_MODULE_PATH),
    ]);
    return { cap, trans, generated };
  };

  it('AC-NUC-001-02 regenerating from design/data/ gives exactly the generated module', async () => {
    const { cap, trans, generated } = await sources();
    expect(generateTablesModule(cap, trans)).toBe(generated);
  });

  it('AC-NUC-001-02 a change in design/data/ without regenerating is detected as drift', async () => {
    const { cap, trans, generated } = await sources();
    const changed = cap.replace(/^version: (\d+)$/m, (_, n: string) => `version: ${Number(n) + 1}`);
    expect(changed).not.toBe(cap);
    expect(generateTablesModule(changed, trans)).not.toBe(generated);
  });

  it('AC-NUC-001-02 generation rejects inconsistent tables', async () => {
    const { cap, trans } = await sources();
    const brokenText = cap.replace(/^(\s+[a-z_.]+: \{[^}\n]*allowed: \[)human(\], decisive: true)/m, '$1human, agent_run$2');
    expect(brokenText).not.toBe(cap);
    expect(() => generateTablesModule(brokenText, trans)).toThrow(/Inconsistent tables/);
  });
});
