import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { actionsFor, canCreate } from '../../src/api/tables.ts';
import type { Tables } from '../../src/api/types.ts';
import { ActionButtons } from '../../src/components/actions.tsx';

function testTables(): Tables {
  return {
    capabilities: {
      commands: {
        'record_version.create': { entity: 'record_version', allowed: ['human'], decisive: false, description: 'Create.' },
        'record_version.approve': { entity: 'record_version', allowed: ['human'], decisive: true, description: 'Approve.' },
        'record_version.discard': { entity: 'record_version', allowed: ['human'], decisive: false, description: 'Discard.' },
        'record_version.supersede': { entity: 'record_version', allowed: ['system'], decisive: false, description: 'Supersede.' },
      },
      queries: {},
    },
    transitions: {
      entities: {
        record_version: {
          label: 'Record version',
          implemented_in: 'S1',
          states: { draft: 'Draft', approved: 'Approved', superseded: 'Superseded', discarded: 'Discarded' },
          authority: ['approved'],
          transitions: [
            { command: 'record_version.create', from: 'new', to: 'draft' },
            { command: 'record_version.approve', from: ['draft'], to: 'approved' },
            { command: 'record_version.supersede', from: ['approved'], to: 'superseded' },
            { command: 'record_version.discard', from: ['draft'], to: 'discarded' },
          ],
        },
      },
    },
  };
}

const handlers = {
  'record_version.approve': { run: () => undefined },
  'record_version.discard': { run: () => undefined },
  'record_version.supersede': { run: () => undefined },
};

function buttons(tables: Tables, state: string): string[] {
  const html = renderToStaticMarkup(
    <ActionButtons actions={actionsFor(tables, undefined, 'record_version', state)} handlers={handlers} />,
  );
  return [...html.matchAll(/data-command="([^"]+)"/g)].map((m) => m[1] ?? '');
}

describe('actions come from the tables', () => {
  it('AC-WEB-001-02 an element offers only the commands the tables allow a person from its state', () => {
    const t = testTables();
    expect(actionsFor(t, undefined, 'record_version', 'draft').map((a) => a.command)).toEqual([
      'record_version.approve',
      'record_version.discard',
    ]);
    // From "approved" there is only a system transition: a person gets no button.
    expect(actionsFor(t, undefined, 'record_version', 'approved')).toEqual([]);
    expect(buttons(t, 'draft')).toEqual(['record_version.approve', 'record_version.discard']);
    expect(buttons(t, 'approved')).toEqual([]);
    // A decisive command is marked as such.
    expect(
      actionsFor(t, undefined, 'record_version', 'draft').find((a) => a.command === 'record_version.approve')?.decisive,
    ).toBe(true);
  });

  it('AC-WEB-001-02 removing the transition from the table makes the button disappear', () => {
    const t = testTables();
    expect(buttons(t, 'draft')).toContain('record_version.approve');
    const def = t.transitions.entities.record_version;
    if (!def) throw new Error('missing entity');
    def.transitions = def.transitions.filter((x) => x.command !== 'record_version.approve');
    expect(buttons(t, 'draft')).toEqual(['record_version.discard']);
  });

  it('AC-WEB-001-02 a command the matrix does not allow a person gives no button, even with a transition', () => {
    const t = testTables();
    const approve = t.capabilities.commands['record_version.approve'];
    if (!approve) throw new Error('missing command');
    approve.allowed = ['system'];
    expect(buttons(t, 'draft')).toEqual(['record_version.discard']);
    expect(canCreate(t, 'record_version.create')).toBe(true);
    expect(canCreate(t, 'record_version.supersede')).toBe(false);
  });

  it('AC-WEB-001-02 a command the API does not implement yet gives no button', () => {
    const t = testTables();
    const catalog = {
      'record_version.approve': {
        ...(t.capabilities.commands['record_version.approve'] ?? { entity: '', allowed: [], decisive: false, description: '' }),
        implemented: false,
        data: null,
      },
    };
    expect(actionsFor(t, catalog, 'record_version', 'draft').map((a) => a.command)).toEqual(['record_version.discard']);
  });
});
