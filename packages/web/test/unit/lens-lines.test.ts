import { TRANSITIONS } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import type { BatchDetail, ChangedThing, Changes, Tables } from '../../src/api/types.ts';
import { changedOf, lineText, linesOf, nothingConfirmedChanged } from '../../src/screens/overview/lens/lines.ts';

let seq = 100;
function ev(command: string, actor: string, extra: Partial<ChangedThing['events'][number]> = {}): ChangedThing['events'][number] {
  seq += 1;
  const [entity] = command.split('.');
  return {
    id: String(seq),
    at: '2026-09-24T18:52:00Z',
    actor,
    command,
    entity_type: entity === 'record' && command.startsWith('record_version') ? 'record_version' : (entity ?? ''),
    entity_id: `e${seq}`,
    entity_version: null,
    state_before: null,
    state_after: null,
    ...extra,
  };
}

const tables = { capabilities: { commands: {}, queries: {} }, transitions: TRANSITIONS } as unknown as Tables;

function batch(
  id: string,
  kind: string,
  producer: string,
  proposals: BatchDetail['proposals'],
  deps: BatchDetail['dependencies'] = [],
) {
  return {
    id,
    project_id: 'p',
    kind,
    producer,
    run_id: null,
    context_pack_id: null,
    resolution_mode: kind === 'agent' ? 'item' : 'package',
    dependencies: deps,
    summary: null,
    tree_hash: null,
    state: 'pending',
    created_at: '',
    resolved_at: null,
    resolved_by: null,
    proposals,
  } as BatchDetail;
}

const proposal = (type: string, payload: Record<string, unknown>, deps: BatchDetail['dependencies'] = []) =>
  ({
    id: `p-${type}`,
    batch_id: 'b',
    position: 1,
    type,
    payload,
    dependencies: deps,
    state: 'pending',
  }) as unknown as BatchDetail['proposals'][number];

describe('While you were away', () => {
  it('AC-INT-001-16 tells one line per thing, from the templates of each kind', () => {
    const changes: Changes = {
      latest: '200',
      things: [
        {
          kind: 'record',
          key: 'FDR-DIS-001',
          title: 'De la intención a «Listo para construir»',
          record_type: 'fdr',
          events: [
            ev('record_version.approve', 'human:ana', {
              entity_type: 'record_version',
              entity_version: 2,
              state_before: 'draft',
              state_after: 'approved',
            }),
          ],
        },
        {
          kind: 'batch',
          key: 'b1',
          title: 'Design proposed from DEC-PLN-001 v1: FDR with 6 criteria.',
          record_type: 'system_package',
          events: [ev('batch.submit', 'agent:run:r1'), ev('proposal.create', 'agent:run:r1')],
        },
        {
          kind: 'batch',
          key: 'b2',
          title: 'Guests',
          record_type: 'agent',
          events: [
            ev('batch.submit', 'agent:claude-code:s'),
            ev('proposal.create', 'agent:claude-code:s'),
            ev('proposal.create', 'agent:claude-code:s'),
            ev('proposal.create', 'agent:claude-code:s'),
          ],
        },
        {
          kind: 'batch',
          key: 'b3',
          title: 'Knowledge suggests reviewing 1 record(s) after x.',
          record_type: 'knowledge',
          events: [ev('batch.submit', 'system:knowledge@1'), ev('proposal.create', 'system:knowledge@1')],
        },
        {
          kind: 'exploration',
          key: 't1',
          title: 'Change Set and frozen tests',
          events: [ev('message.post', 'human:ana'), ev('message.post', 'agent:run:r2'), ev('question.raise', 'system:agents@1')],
        },
        {
          kind: 'knowledge',
          key: 'knowledge',
          title: null,
          events: [ev('knowledge_update.apply', 'system:knowledge@1'), ev('knowledge_update.apply', 'system:knowledge@1')],
        },
        { kind: 'project', key: 'p', title: null, events: [ev('source.register', 'agent:claude-code:s')] },
      ],
    };
    const lines = linesOf(changes, {
      batches: {
        b1: batch('b1', 'system_package', 'agent:run:r1', [
          proposal('fdr', { title: 'Change Set y pruebas congeladas', criteria: [1, 2, 3, 4, 5, 6] }),
        ]),
        b2: batch(
          'b2',
          'agent',
          'agent:claude-code:s',
          [proposal('decision', {}), proposal('decision', {}), proposal('decision', {})],
          [{ type: 'record', id: 'r', code: 'FDR-S3A-001', version: 1 }],
        ),
        b3: batch('b3', 'knowledge', 'system:knowledge@1', [
          proposal('review', { record: { code: 'DEC-PLN-001', version: 1 }, reason: 'x' }),
        ]),
      },
      records: {
        'FDR-S3A-001': { title: 'Change Set', checks: 6 },
        'DEC-PLN-001': { title: 'Reimplementar DEMIURGO como v2', checks: 0 },
      },
    });
    expect(lines.map((l) => l.id)).toEqual([
      'record:FDR-DIS-001',
      'batch:b1',
      'batch:b2',
      'batch:b3',
      'exploration:t1',
      'knowledge:knowledge',
      'project:p',
    ]);
    expect(lines.map(lineText)).toEqual([
      'You approved version 2 of De la intención a «Listo para construir».',
      'DEMIURGO drafted Change Set y pruebas congeladas (6 checks).',
      'An agent proposed 3 changes to Change Set.',
      'Knowledge found a conflict in Reimplementar DEMIURGO como v2.',
      'DEMIURGO answered in Change Set and frozen tests and asked 1 question.',
      'Knowledge was brought up to date (2 updates).',
      'An agent registered 1 source.',
    ]);
    expect(lines[0]?.codes).toEqual(['FDR-DIS-001']);
    expect(lines[2]?.codes).toEqual(['FDR-S3A-001']);
    expect(lines[3]).toMatchObject({ problem: true, codes: ['DEC-PLN-001'] });
    expect(lines[2]?.actor).toBe('agent:claude-code:s');
  });

  it('AC-INT-001-16 highlights the records and threads that changed, including the records a batch is about', () => {
    const changes: Changes = {
      latest: '10',
      things: [
        {
          kind: 'record',
          key: 'FDR-DIS-001',
          title: 'x',
          record_type: 'fdr',
          events: [ev('record_version.create', 'human:ana', { entity_version: 2 })],
        },
        {
          kind: 'batch',
          key: 'b',
          title: 'y',
          record_type: 'agent',
          events: [ev('batch.submit', 'agent:claude-code:s'), ev('proposal.create', 'agent:claude-code:s')],
        },
        { kind: 'exploration', key: 't', title: 'z', events: [ev('message.post', 'agent:claude-code:s')] },
        { kind: 'knowledge', key: 'knowledge', title: null, events: [ev('idea_assessment.record', 'system:knowledge@1')] },
      ],
    };
    const lines = linesOf(changes, {
      batches: {
        b: batch('b', 'agent', 'agent:claude-code:s', [
          proposal('fdr', {}, [{ type: 'record', id: 'r', code: 'FDR-INT-001', version: 1 }]),
        ]),
      },
    });
    const changed = changedOf(lines);
    expect([...changed.records.keys()].sort()).toEqual(['FDR-DIS-001', 'FDR-INT-001']);
    expect(changed.records.get('FDR-DIS-001')).toBe('New draft v2');
    expect(changed.records.get('FDR-INT-001')).toBe('1 change proposed');
    expect([...changed.threads.keys()]).toEqual(['t']);
    expect(lineText(lines[2] ?? { segments: [] })).toBe('An agent wrote in z.');
    expect(lineText(lines[3] ?? { segments: [] })).toBe('Knowledge checked 1 idea against what it knows.');
  });

  it('AC-INT-001-16 ends with "Nothing you confirmed was changed" only when no event left an authority state', () => {
    const quiet: Changes = {
      latest: '1',
      things: [
        {
          kind: 'record',
          key: 'A',
          title: 'a',
          events: [
            ev('record_version.approve', 'human:ana', {
              entity_type: 'record_version',
              state_before: 'draft',
              state_after: 'approved',
            }),
          ],
        },
        {
          kind: 'batch',
          key: 'b',
          title: 'b',
          events: [
            ev('proposal.accept', 'human:ana', { entity_type: 'proposal', state_before: 'pending', state_after: 'accepted' }),
          ],
        },
      ],
    };
    expect(nothingConfirmedChanged(quiet, tables)).toBe(true);
    const replaced: Changes = {
      latest: '2',
      things: [
        {
          kind: 'record',
          key: 'A',
          title: 'a',
          events: [
            ev('record_version.supersede', 'system:versions@1', {
              entity_type: 'record_version',
              state_before: 'approved',
              state_after: 'superseded',
            }),
          ],
        },
      ],
    };
    expect(nothingConfirmedChanged(replaced, tables)).toBe(false);
    const reopened: Changes = {
      latest: '3',
      things: [
        {
          kind: 'exploration',
          key: 't',
          title: 't',
          events: [
            ev('question.reopen', 'human:ana', { entity_type: 'question', state_before: 'confirmed', state_after: 'pending' }),
          ],
        },
      ],
    };
    expect(nothingConfirmedChanged(reopened, tables)).toBe(false);
  });
});
