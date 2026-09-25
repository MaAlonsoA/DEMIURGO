import { describe, expect, it } from 'vitest';
import type { BatchDetail, Message, Proposal, Question, RunListItem } from '../../src/api/types.ts';
import {
  IDEA_EXAMPLES,
  answerOf,
  answersOf,
  dayLabel,
  daySummary,
  decisionRequest,
  isDecisionRequest,
  pendingInOrder,
  personMessages,
  promptOf,
  purposeOf,
  readingOf,
  readingsOf,
  understandingOf,
  walkSummary,
  writtenBy,
} from '../../src/screens/onboarding/day.ts';
import { landingOf } from '../../src/screens/onboarding/landing.ts';
import { shortDate } from '../../src/lib/time.ts';

const at = (s: number) => new Date(Date.UTC(2026, 8, 24, 10, 0, s)).toISOString();
const T = (s: number) => Date.parse(at(s));

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
    requested_by: 'system:conversation@1',
    created_at: at(s),
    started_at: at(s),
    finished_at: ['queued', 'running'].includes(state) ? null : at(s + 5),
    context_pack_hash: 'h1',
    exploration_id: 'e1',
    batch_id: null,
    ...extra,
  };
}

function question(id: string, state: string, s: number, extra: Partial<Question> = {}): Question {
  return {
    id,
    exploration_id: 'e1',
    question: `question ${id}?`,
    reason: null,
    impact: null,
    conclusion: null,
    reasoning: null,
    state,
    state_reason: null,
    raised_by: 'system:exploration@1',
    created_at: at(s),
    epistemic_status: 'pending',
    ...extra,
  };
}

function proposal(id: string, type: string, state = 'pending', title = `title ${id}`): Proposal {
  return {
    id,
    batch_id: 'b1',
    position: 0,
    type,
    payload: { title },
    dependencies: [],
    state,
    resolution: null,
    resolved_by: null,
    resolved_at: null,
    created_at: at(0),
    epistemic_status: 'proposed',
  };
}

function batch(id: string, proposals: Proposal[], state = 'pending'): BatchDetail {
  return {
    id,
    project_id: 'p1',
    kind: 'agent',
    producer: 'agent:run:r1',
    run_id: 'r1',
    context_pack_id: null,
    resolution_mode: 'item',
    dependencies: [],
    summary: null,
    tree_hash: null,
    state,
    created_at: at(0),
    resolved_at: null,
    resolved_by: null,
    proposals: proposals.map((p) => ({ ...p, batch_id: id })),
  };
}

describe('the idea and its thread', () => {
  it('uses the idea as the purpose, trimmed to what a thread accepts', () => {
    expect(purposeOf('  An app for my club.  ')).toBe('An app for my club.');
    const long = 'word '.repeat(400);
    const purpose = purposeOf(long);
    expect(purpose.length).toBeLessThanOrEqual(1000);
    expect(purpose.endsWith('…')).toBe(true);
  });

  it('takes the idea from the first message of a person, not from DEMIURGO', () => {
    const messages = [
      message('m2', 'agent:run:r1', 5),
      message('m1', 'human:ana', 1, { body: 'The idea' }),
      message('m3', 'human:ana', 9, { body: 'A correction' }),
    ];
    expect(personMessages(messages).map((m) => m.body)).toEqual(['The idea', 'A correction']);
  });

  it('offers examples that fill a name and an idea', () => {
    expect(IDEA_EXAMPLES.map((e) => e.label)).toEqual([
      'Activities for my association',
      'Bookings for a small studio',
      'A simple game in Python',
    ]);
    for (const e of IDEA_EXAMPLES) {
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.name.length).toBeLessThanOrEqual(120);
      expect(e.idea.length).toBeLessThanOrEqual(1000);
    }
  });
});

describe('the reading of a message', () => {
  const idea = message('m1', 'human:ana', 10);

  it('is answered by the first conversation requested after it, followed through its retries', () => {
    const before = run('r0', 'completed', 1);
    const failed = run('r1', 'failed', 12, { failure_kind: 'agent_error' });
    const retry = run('r2', 'completed', 20, { retry_of: 'r1' });
    const draft = run('r3', 'completed', 11, { action: 'design_proposal' });
    expect(answerOf([before, retry, failed, draft], idea.created_at)?.id).toBe('r2');
    expect(answerOf([before, failed, draft], idea.created_at)?.id).toBe('r1');
    expect(answerOf([before, draft], idea.created_at)).toBeNull();
  });

  it('says where the answer stands from the message itself, never from the clock', () => {
    // The server says it is waiting for knowledge: DEMIURGO is catching up, however long it takes.
    expect(readingOf([], message('m1', 'human:ana', 10, { response: 'waiting' }))).toEqual({ phase: 'catching_up', run: null });
    // Requested: the run the message links to, even before the run list brings it.
    expect(readingOf([], message('m1', 'human:ana', 10, { response: 'requested', response_run: 'r9' })).phase).toBe('waiting');
    const linked = message('m1', 'human:ana', 10, { response: 'requested', response_run: 'r1' });
    const failed = run('r1', 'failed', 12, { failure_kind: 'agent_error' });
    const retry = run('r2', 'running', 20, { retry_of: 'r1' });
    expect(readingOf([failed, retry], linked)).toEqual({ phase: 'working', run: retry });
    // Abandoned: only then is it offered to ask again.
    expect(readingOf([], message('m1', 'human:ana', 10, { response: 'abandoned' })).phase).toBe('unanswered');
    // No answer asked for, and nothing after it.
    expect(readingOf([], idea).phase).toBe('unanswered');
    expect(readingOf([], undefined).phase).toBe('unanswered');
  });

  it('follows the state of the run that answers it', () => {
    const phase = (state: string) => readingOf([run('r1', state, 12)], idea).phase;
    expect(phase('queued')).toBe('working');
    expect(phase('running')).toBe('working');
    expect(phase('failed')).toBe('failed');
    expect(phase('interrupted')).toBe('failed');
    expect(phase('cancelled')).toBe('cancelled');
    expect(phase('completed')).toBe('read');
  });

  it('shows what the run wrote: its reply and its observations', () => {
    const messages = [
      message('m1', 'human:ana', 1),
      message('m2', 'agent:run:r1', 5, { run_id: 'r1', body: 'Got it' }),
      message('m3', 'agent:run:r1', 5, { run_id: 'r1', kind: 'hypothesis', body: 'The main intent is…' }),
      message('m4', 'agent:run:r1', 5, { run_id: 'r1', kind: 'unknown', body: 'Who pays?' }),
      message('m5', 'agent:run:r2', 9, { run_id: 'r2', body: 'Another reply' }),
    ];
    const written = writtenBy(messages, 'r1');
    expect(written.reply?.body).toBe('Got it');
    expect(written.observations.map((o) => o.kind)).toEqual(['hypothesis', 'unknown']);
  });

  it('keeps as the understanding the last conversation that answered the idea or a correction', () => {
    const messages = [
      message('m1', 'human:ana', 0, { body: 'The idea' }),
      message('m2', 'human:ana', 20, { body: 'A correction' }),
      message('m3', 'human:ana', 45, { body: 'I decide: members only.' }),
    ];
    const retried = run('r2', 'failed', 30);
    const retry = run('r2b', 'completed', 35, { retry_of: 'r2' });
    const runs = [
      run('r1', 'completed', 1),
      retried,
      retry,
      run('r3', 'completed', 50),
      run('r4', 'completed', 60, { action: 'design_proposal' }),
    ];
    // r2b retries r2, which answered the correction; r3 answers "I decide:".
    expect(promptOf(retry, messages, runs)?.body).toBe('A correction');
    expect(readingsOf(messages, runs).map((r) => r.id)).toEqual(['r1', 'r2b']);
    expect(understandingOf(messages, runs)?.id).toBe('r2b');
    expect(understandingOf(messages.slice(0, 1), [run('r1', 'failed', 1)])).toBeNull();
  });
});

describe('the questions of the day', () => {
  it('walks the open questions in the order they were asked', () => {
    const qs = [question('q2', 'pending', 5), question('q1', 'pending', 1), question('q3', 'confirmed', 3)];
    expect(pendingInOrder(qs).map((q) => q.id)).toEqual(['q1', 'q2']);
  });

  it('says what happened to the questions walked', () => {
    const walked = (...states: string[]) => states.map((s, i) => question(`q${i}`, s, i));
    expect(walkSummary(walked('confirmed', 'pending', 'postponed'))).toBe('You answered 1, skipped 1 and parked 1.');
    expect(walkSummary(walked('confirmed', 'confirmed'))).toBe('You answered 2.');
    expect(walkSummary(walked('pending', 'inferred'))).toBe('You answered 0 and skipped 2.');
    expect(walkSummary(walked('confirmed', 'discarded'))).toBe('You answered 1 and dropped 1.');
  });

  it('takes the answers from the confirmed questions', () => {
    const qs = [
      question('q2', 'confirmed', 5, { question: 'Can anyone sign up?', conclusion: 'Only members' }),
      question('q1', 'confirmed', 1, { question: 'Who uses it?', conclusion: 'Members of the club.' }),
      question('q3', 'postponed', 3, { conclusion: null }),
      question('q4', 'inferred', 4, { conclusion: 'Assumed by DEMIURGO' }),
    ];
    expect(answersOf(qs)).toEqual([
      { question: 'Who uses it?', conclusion: 'Members of the club.' },
      { question: 'Can anyone sign up?', conclusion: 'Only members' },
    ]);
  });

  it('asks DEMIURGO to propose decisions with a message that starts with "I decide:"', () => {
    const text = decisionRequest([
      { question: 'Who uses it?', conclusion: 'Members of the club.' },
      { question: 'Can anyone sign up?', conclusion: 'Only members' },
    ]);
    expect(text.startsWith('I decide: Members of the club. Only members.')).toBe(true);
    expect(text).toContain('- Who uses it? → Members of the club.');
    expect(text).toContain('- Can anyone sign up? → Only members.');
    expect(text).toContain('Propose each one as a decision for me to review.');
    expect(text.length).toBeLessThanOrEqual(20_000);
    expect(decisionRequest([{ question: 'Q?', conclusion: 'x'.repeat(30_000) }]).length).toBe(20_000);
  });

  it('recognises that request among the messages of the thread', () => {
    expect(isDecisionRequest(message('m1', 'human:ana', 1, { body: 'I decide: members only.' }))).toBe(true);
    expect(isDecisionRequest(message('m2', 'human:ana', 1, { body: 'We want an app.' }))).toBe(false);
    expect(isDecisionRequest(message('m3', 'agent:run:r1', 1, { body: 'I decide: nothing' }))).toBe(false);
  });
});

describe('the summary of the day', () => {
  it('says "Today" for a thread opened today and the date otherwise', () => {
    const now = Date.UTC(2026, 8, 24, 18, 0, 0);
    expect(dayLabel(at(0), now)).toBe('Today');
    const before = new Date(Date.UTC(2026, 8, 20, 10, 0, 0)).toISOString();
    expect(dayLabel(before, now)).toBe(shortDate(before));
  });

  it('counts the idea, the answered questions and the decisions proposed, and what still waits', () => {
    const summary = daySummary({
      openedAt: at(0),
      messages: [message('m1', 'human:ana', 0), message('m2', 'agent:run:r2', 9 * 60)],
      questions: [
        question('q1', 'confirmed', 60, { conclusion: 'Members' }),
        question('q2', 'pending', 60),
        question('q3', 'postponed', 60),
      ],
      runs: [run('r1', 'completed', 30), run('r2', 'completed', 8 * 60, { finished_at: at(14 * 60), batch_id: 'b1' })],
      batches: [batch('b1', [proposal('p1', 'decision'), proposal('p2', 'decision', 'accepted'), proposal('p3', 'exploration')])],
      now: T(20 * 60),
    });
    expect(summary.minutes).toBe(14);
    expect(summary.answered).toBe(1);
    expect(summary.proposed).toBe(2);
    expect(summary.waiting.map((w) => [w.batchId, w.proposalId, w.title])).toEqual([['b1', 'p1', 'title p1']]);
    expect(summary.open.map((q) => q.id)).toEqual(['q2']);
    expect(summary.parked.map((q) => q.id)).toEqual(['q3']);
  });

  it('never says less than a minute', () => {
    const s = daySummary({ openedAt: at(0), messages: [], questions: [], runs: [], batches: [], now: T(5) });
    expect(s.minutes).toBe(1);
    expect(s.proposed).toBe(0);
  });
});

describe('where DEMIURGO opens', () => {
  it('goes to "What do you want to build?" with no projects, into the only one, or to the list', () => {
    expect(landingOf([])).toEqual({ to: '/new' });
    expect(landingOf([{ id: 'p1' }])).toEqual({ to: '/p/$projectId', projectId: 'p1' });
    expect(landingOf([{ id: 'p1' }, { id: 'p2' }])).toEqual({ to: '/projects' });
  });
});
