import { describe, expect, it } from 'vitest';
import type { ChangedThing, Changes } from '../../src/api/types.ts';
import { lineText } from '../../src/screens/overview/lens/lines.ts';
import { ownToday, todayLines } from '../../src/screens/needs-you/today.ts';

const NOW = new Date(2026, 8, 24, 18, 0);
const today = (h: number, m = 0) => new Date(2026, 8, 24, h, m).toISOString();
const yesterday = new Date(2026, 8, 23, 22, 0).toISOString();

let seq = 0;
function ev(command: string, actor: string, at: string, extra: Partial<ChangedThing['events'][number]> = {}) {
  seq += 1;
  return {
    id: String(seq),
    at,
    actor,
    command,
    entity_type: command.split('.')[0] ?? '',
    entity_id: `e${seq}`,
    entity_version: null,
    state_before: null,
    state_after: null,
    ...extra,
  };
}

const changes: Changes = {
  latest: '99',
  things: [
    {
      kind: 'record',
      key: 'DEC-EVT-001',
      title: 'Guests are allowed',
      record_type: 'decision',
      events: [
        ev('record.create', 'human:ana', yesterday),
        ev('record_version.approve', 'human:ana', today(9, 6), { entity_type: 'record_version', entity_version: 1 }),
      ],
    },
    {
      kind: 'exploration',
      key: 't1',
      title: 'Guests at activities',
      events: [
        ev('message.post', 'human:ana', today(9, 7)),
        ev('message.post', 'agent:run:r1', today(9, 8)),
        ev('question.raise', 'agent:run:r1', today(9, 8)),
      ],
    },
    {
      kind: 'knowledge',
      key: 'knowledge',
      title: null,
      events: [ev('knowledge_update.apply', 'system:knowledge@1', today(9, 9))],
    },
    {
      kind: 'exploration',
      key: 't0',
      title: 'Old thread',
      events: [ev('exploration.open', 'human:ana', yesterday)],
    },
  ],
};

describe('what you did today', () => {
  it("AC-INT-001-11 keeps only the person's own events of today", () => {
    const own = ownToday(changes, NOW);
    expect(own.things.map((t) => [t.key, t.events.map((e) => e.command)])).toEqual([
      ['DEC-EVT-001', ['record_version.approve']],
      ['t1', ['message.post']],
    ]);
  });

  it('tells them in a few lines, in the order they happened, with the lens templates', () => {
    const lines = todayLines(changes, NOW);
    expect(lines.map(lineText)).toEqual(['You approved version 1 of Guests are allowed.', 'You wrote in Guests at activities.']);
    expect(lines.every((l) => l.actor === 'human:ana')).toBe(true);
    expect(todayLines({ latest: '0', things: [] }, NOW)).toEqual([]);
  });
});
