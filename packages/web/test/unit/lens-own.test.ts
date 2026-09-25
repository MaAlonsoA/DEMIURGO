import { describe, expect, it } from 'vitest';
import type { ChangedThing, Changes } from '../../src/api/types.ts';
import { isOwnCurrent, lineTarget, withoutOwn } from '../../src/screens/overview/lens/own.ts';

function ev(id: number, actor: string, at: string, command = 'record_version.approve'): ChangedThing['events'][number] {
  return {
    id: String(id),
    at,
    actor,
    command,
    entity_type: 'record_version',
    entity_id: `e${id}`,
    entity_version: 1,
    state_before: 'draft',
    state_after: 'approved',
  };
}

const START = Date.parse('2026-09-25T10:00:00Z');

describe('what the lens leaves out: the person’s own actions of this session', () => {
  it('AC-INT-001-16 an event is the person’s own and current after the first event this tab saw, or after the app started', () => {
    const mine = ev(20, 'human:ana', '2026-09-25T10:05:00Z');
    expect(isOwnCurrent(mine, 'human:ana', { event: '15', at: START })).toBe(true);
    // Before this session (another browser, before a reload): it is told.
    expect(isOwnCurrent(ev(12, 'human:ana', '2026-09-25T09:00:00Z'), 'human:ana', { event: '15', at: START })).toBe(false);
    // Somebody else's: always told.
    expect(isOwnCurrent(ev(21, 'agent:claude-code:s1', '2026-09-25T10:06:00Z'), 'human:ana', { event: '15', at: START })).toBe(
      false,
    );
    // Before the stream said where the log was: the app's start time decides.
    expect(isOwnCurrent(mine, 'human:ana', { event: null, at: START })).toBe(true);
    expect(isOwnCurrent(ev(13, 'human:ana', '2026-09-25T09:59:00Z'), 'human:ana', { event: null, at: START })).toBe(false);
    // Without a person signed in nothing is left out.
    expect(isOwnCurrent(mine, null, { event: '15', at: START })).toBe(false);
  });

  it('AC-INT-001-16 drops those events and the things left without any', () => {
    const changes: Changes = {
      latest: '30',
      things: [
        { kind: 'record', key: 'DEC-PLN-001', title: 'Plan', events: [ev(20, 'human:ana', '2026-09-25T10:05:00Z')] },
        {
          kind: 'record',
          key: 'FDR-INT-001',
          title: 'Design',
          events: [ev(18, 'agent:claude-code:s1', '2026-09-25T10:01:00Z'), ev(22, 'human:ana', '2026-09-25T10:07:00Z')],
        },
      ],
    };
    const told = withoutOwn(changes, 'human:ana', { event: '15', at: START });
    expect(told.things.map((t) => [t.key, t.events.map((e) => e.id)])).toEqual([['FDR-INT-001', ['18']]]);
    expect(withoutOwn(changes, null, { event: '15', at: START })).toBe(changes);
  });
});

describe('where a line of the lens leads', () => {
  it('AC-INT-001-16 to the record, the thread, the batch, knowledge, or what the project change was about', () => {
    expect(lineTarget({ kind: 'record', key: 'FDR-INT-001' })).toEqual({
      to: '/p/$projectId/records/$code',
      params: { code: 'FDR-INT-001' },
    });
    expect(lineTarget({ kind: 'exploration', key: 't1' })?.to).toBe('/p/$projectId/threads/$explorationId');
    expect(lineTarget({ kind: 'batch', key: 'b1' })?.to).toBe('/p/$projectId/batches/$batchId');
    expect(lineTarget({ kind: 'knowledge', key: 'knowledge' })?.to).toBe('/p/$projectId/knowledge');
    expect(lineTarget({ kind: 'project', key: 'p' }, { events: [ev(1, 'human:ana', '', 'source.register')] })?.to).toBe(
      '/p/$projectId/sources',
    );
    expect(lineTarget({ kind: 'project', key: 'p' }, { events: [ev(1, 'human:ana', '', 'agent_token.issue')] })?.to).toBe(
      '/p/$projectId/agent-keys',
    );
    expect(lineTarget({ kind: 'project', key: 'p' }, { events: [ev(1, 'human:ana', '', 'project.create')] })).toBeNull();
  });
});
