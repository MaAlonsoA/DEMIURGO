import { describe, expect, it } from 'vitest';
import type { Message, ProductRow, Question, RunListItem } from '../../src/api/types.ts';
import {
  ASSUMED,
  answerChoices,
  draftOf,
  isOpenQuestion,
  isShown,
  pickedChoices,
  plainText,
  withExclusive,
} from '../../src/screens/thread/answers.ts';
import { buildTimeline, draftableDecisions, progressWords, runDisplay, sideMessages } from '../../src/screens/thread/timeline.ts';

const at = (s: number) => new Date(Date.UTC(2026, 8, 24, 10, 0, s)).toISOString();

function message(id: string, author: string, s: number, extra: Partial<Message> = {}): Message {
  return {
    id,
    exploration_id: 'e1',
    question_id: null,
    author,
    run_id: null,
    kind: null,
    body: `text of ${id}`,
    state: 'recorded',
    created_at: at(s),
    epistemic_status: null,
    response: null,
    response_run: null,
    ...extra,
  };
}

function run(id: string, state: string, s: number, extra: Partial<RunListItem> = {}): RunListItem {
  return {
    id,
    state,
    action: 'exploration_chat',
    scope: { type: 'exploration', id: 'e1' },
    provider: 'simulated',
    model: null,
    retry_of: null,
    failure_kind: null,
    error: null,
    requested_by: 'system:exploration@1',
    created_at: at(s),
    started_at: at(s),
    finished_at: ['queued', 'running'].includes(state) ? null : at(s + 5),
    context_pack_hash: 'h1',
    exploration_id: 'e1',
    batch_id: null,
    ...extra,
  };
}

describe('the timeline of a thread', () => {
  it("AC-INT-001-04 groups DEMIURGO's reply with its observations and keeps people's messages apart", () => {
    const items = buildTimeline(
      [
        message('m1', 'human:ana', 1),
        message('m2', 'agent:run:r1', 10, { run_id: 'r1' }),
        message('m3', 'agent:run:r1', 10, { run_id: 'r1', kind: 'hypothesis' }),
        message('m4', 'agent:run:r1', 10, { run_id: 'r1', kind: 'unknown' }),
        message('m5', 'agent:claude-code:t1', 20),
      ],
      [run('r1', 'completed', 2)],
    );
    expect(items.map((i) => i.type)).toEqual(['message', 'demiurgo', 'message']);
    const d = items[1];
    expect(d?.type === 'demiurgo' && d.reply?.id).toBe('m2');
    expect(d?.type === 'demiurgo' && d.observations.map((o) => o.kind)).toEqual(['hypothesis', 'unknown']);
    expect(items[2]?.type === 'message' && items[2].by).toBe('agent');
  });

  it('AC-INT-001-10 shows a run while it works, when it failed, when it was cancelled and when it left a draft', () => {
    const runs = [
      run('working', 'running', 30),
      run('failed', 'failed', 1, { failure_kind: 'agent_error' }),
      run('cancelled', 'cancelled', 2),
      run('draft', 'completed', 3, { action: 'design_proposal', batch_id: 'b1' }),
      run('talk', 'completed', 4),
    ];
    expect(runs.map((r) => runDisplay(r, runs))).toEqual(['working', 'failed', 'cancelled', 'draft', null]);
    expect(runDisplay(run('i', 'interrupted', 1), [])).toBe('failed');
  });

  it('AC-INT-001-10 a failed run that was retried stays as retried, without its Retry', () => {
    const failed = run('r1', 'failed', 1);
    const runs = [failed, run('r2', 'completed', 20, { retry_of: 'r1' })];
    expect(runDisplay(failed, runs)).toBe('retried');
    const items = buildTimeline([message('m1', 'human:ana', 0)], runs);
    expect(items.map((i) => i.key)).toEqual(['m:m1', 'r:r1']);
  });

  it('AC-INT-001-10 orders messages and runs by time: a run in progress goes after what asked for it', () => {
    const items = buildTimeline(
      [message('m1', 'human:ana', 1), message('m2', 'human:ana', 40)],
      [run('r1', 'running', 6), run('r0', 'failed', 0)],
    );
    // r0 finished at 5 s and r1 started at 6 s: both after m1 and before m2, in the order they happened.
    expect(items.map((i) => i.key)).toEqual(['m:m1', 'r:r0', 'r:r1', 'm:m2']);
  });
});

describe('Draft it', () => {
  const row = (code: string, extra: Partial<ProductRow>): ProductRow => ({
    code,
    type: 'decision',
    domain: 'plan',
    title: `Title of ${code}`,
    current: 1,
    latest: { n: 1, state: 'approved' },
    epistemic_status: 'confirmed',
    readiness: null,
    implementation: 'not_built',
    summary: '',
    checks: 0,
    latest_id: `${code}-v1`,
    current_id: `${code}-v1`,
    updated_at: at(0),
    updated_by: 'human:ana',
    origin_exploration: null,
    ...extra,
  });

  it('AC-INT-001-10 offers only approved decisions, the ones born in the thread first', () => {
    const list = draftableDecisions(
      [
        row('DEC-A', {}),
        row('DEC-B', { origin_exploration: 'e1' }),
        row('DEC-C', { current: null, current_id: null, latest: { n: 1, state: 'draft' } }),
        row('FDR-A', { type: 'fdr' }),
      ],
      'e1',
    );
    expect(list.map((d) => [d.code, d.bornHere])).toEqual([
      ['DEC-B', true],
      ['DEC-A', false],
    ]);
    expect(list[0]?.versionId).toBe('DEC-B-v1');
  });
});

describe('live progress in the thread', () => {
  it("AC-INT-001-10 drops the provider call clock: the card shows one time, the run's", () => {
    expect(progressWords('Thinking… 1,240 tokens · 0:12')).toBe('Thinking… 1,240 tokens');
    expect(progressWords('Starting… 0:03')).toBe('Starting…');
    expect(progressWords('Writing… 12 tokens · 1:02:03')).toBe('Writing… 12 tokens');
  });
});

describe('answering a question in its thread', () => {
  const q = (extra: Partial<Question> = {}): Question => ({
    id: 'q1',
    exploration_id: 'e1',
    question: 'Who uses it first?',
    reason: null,
    impact: null,
    conclusion: null,
    reasoning: null,
    state: 'pending',
    state_reason: null,
    raised_by: 'agent:run:r1',
    created_at: at(0),
    epistemic_status: 'pending',
    options: [
      { answer: 'Me', implies: 'Single user.' },
      { answer: 'A team', implies: 'Accounts.' },
      { answer: 'Nobody yet', implies: 'Stop here.', exclusive: true },
    ],
    shown_at: at(1),
    ...extra,
  });

  it("AC-INT-001-09 offers DEMIURGO's assumed answer first, then the options", () => {
    const choices = answerChoices(q({ state: 'inferred', conclusion: 'Me', reasoning: 'You said so.' }));
    expect(choices.map((c) => [c.value, c.answer])).toEqual([
      [ASSUMED, 'Me'],
      ['0', 'Me'],
      ['1', 'A team'],
      ['2', 'Nobody yet'],
    ]);
    expect(choices[0]?.implies).toBe('DEMIURGO assumed it: You said so.');
    expect(answerChoices(q()).map((c) => c.value)).toEqual(['0', '1', '2']);
  });

  it('AC-INT-001-09 a draft names the options it picks, in their order, and reads back the same', () => {
    const multi = q({ multiple: true });
    expect(draftOf(multi, ['1', '0'])).toBe('Me · A team');
    expect(pickedChoices(multi, 'Me · A team')).toEqual(['0', '1']);
    expect(pickedChoices(multi, 'Me · something else')).toEqual([]);
    expect(pickedChoices(q(), 'A team')).toEqual(['1']);
    expect(pickedChoices(q(), 'My own words')).toEqual([]);
    const assumed = q({ state: 'inferred', conclusion: 'We start with me.' });
    expect(pickedChoices(assumed, 'We start with me.')).toEqual([ASSUMED]);
    expect(draftOf(assumed, [ASSUMED])).toBe('We start with me.');
    expect(draftOf(q(), [])).toBeNull();
  });

  it('AC-INT-001-09 an exclusive option clears the others, and any other clears it', () => {
    const choices = answerChoices(q({ multiple: true }));
    expect(withExclusive(choices, ['0', '1'], ['0', '1', '2'])).toEqual(['2']);
    expect(withExclusive(choices, ['2'], ['2', '0'])).toEqual(['0']);
    expect(withExclusive(choices, ['0', '1'], ['1'])).toEqual(['1']);
  });

  it('AC-INT-001-09 only open questions that were shown are answered in the thread', () => {
    expect(isOpenQuestion(q())).toBe(true);
    expect(isOpenQuestion(q({ state: 'inferred' }))).toBe(true);
    expect(isOpenQuestion(q({ state: 'postponed' }))).toBe(false);
    expect(isShown(q({ shown_at: null }))).toBe(false);
  });

  it('AC-INT-001-09 a reply of DEMIURGO becomes plain words for the answer', () => {
    expect(
      plainText(
        '## Option\n\n**Start** with *one* person, see [the doc](http://x).\n\n- first\n- `second`\n\n| a | b |\n|---|---|\n| 1 | 2 |',
      ),
    ).toBe('Option\n\nStart with one person, see the doc.\n\nfirst\nsecond\n\na · b\n1 · 2');
  });
});

describe('Go deeper', () => {
  it('AC-INT-001-09 what a run wrote in a side conversation stays there, observations included', () => {
    const messages = [
      message('m1', 'human:ana', 1),
      message('m2', 'human:ana', 2, { question_id: 'q1' }),
      message('m3', 'agent:run:r2', 3, { run_id: 'r2', question_id: 'q1' }),
      message('m4', 'agent:run:r2', 3, { run_id: 'r2', kind: 'hypothesis' }),
      message('m5', 'agent:run:r3', 4, { run_id: 'r3' }),
    ];
    expect(buildTimeline(messages, []).map((i) => i.key)).toEqual(['m:m1', 'd:m5']);
    expect(sideMessages(messages, 'q1').map((m) => m.id)).toEqual(['m2', 'm3', 'm4']);
    expect(sideMessages(messages, 'q2')).toEqual([]);
  });
});
