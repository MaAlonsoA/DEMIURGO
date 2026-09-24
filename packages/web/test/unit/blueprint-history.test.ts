import { describe, expect, it } from 'vitest';
import type { EventRow } from '../../src/api/types.ts';
import { historyLines } from '../../src/screens/blueprint/history.ts';

function event(id: number, command: string, entity: string, actor = 'human:ana', version: number | null = null): EventRow {
  return {
    id: String(id),
    project_id: 'p',
    seq: String(id),
    at: `2026-09-24T10:${String(id).padStart(2, '0')}:00Z`,
    actor,
    command,
    entity_type: 'record_version',
    entity_id: entity,
    entity_version: version,
    state_before: null,
    state_after: null,
    before: null,
    after: null,
    cause: null,
  };
}

describe('the history of a record', () => {
  it('AC-INT-001-08 tells who created, approved, replaced and discarded each version, newest first', () => {
    const versions = [
      { id: 'v1', n: 1 },
      { id: 'v2', n: 2 },
      { id: 'v3', n: 3 },
    ];
    const lines = historyLines(versions, [
      [event(10, 'record_version.create', 'v1', 'human:ana', 1), event(12, 'record_version.approve', 'v1', 'human:ana', 1)],
      [
        event(15, 'record_version.create', 'v2', 'human:ana', 2),
        event(18, 'record_version.approve', 'v2', 'human:ana', 2),
        // The same event can come twice (two queries): it is told once.
        event(18, 'record_version.approve', 'v2', 'human:ana', 2),
      ],
      [event(20, 'record_version.create', 'v3'), event(22, 'record_version.discard', 'v3')],
      [event(19, 'record_version.supersede', 'v1', 'system:versions@1', 1)],
    ]);
    expect(lines.map((l) => [l.words, l.actor])).toEqual([
      ['Discarded v3', 'human:ana'],
      ['Created v3', 'human:ana'],
      ['v1 was replaced', 'system:versions@1'],
      ['Approved v2', 'human:ana'],
      ['Created v2', 'human:ana'],
      ['Approved v1', 'human:ana'],
      ['Created v1', 'human:ana'],
    ]);
    expect(lines[0]?.at).toBe('2026-09-24T10:22:00Z');
  });

  it('AC-INT-001-08 an event without its own words says its command and version', () => {
    const lines = historyLines([{ id: 'v1', n: 1 }], [[event(3, 'record_version.frobnicate', 'v1')]]);
    expect(lines.map((l) => l.words)).toEqual(['record_version.frobnicate · v1']);
    expect(historyLines([], [])).toEqual([]);
  });
});
