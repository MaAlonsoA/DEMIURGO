import { describe, expect, it } from 'vitest';
import type { Exploration, ExplorationDetail, Message, RunListItem } from '../../src/api/types.ts';
import { type AskSubject, PRODUCT_PURPOSE, askPlaceholder, askProgress, openThreadData, threadFor } from '../../src/ui/ask.ts';

const at = (m: number) => new Date(Date.UTC(2026, 8, 24, 10, m)).toISOString();

function thread(id: string, extra: Partial<Exploration> = {}): Exploration {
  return {
    id,
    project_id: 'p',
    parent_id: null,
    purpose: `Purpose ${id}`,
    origin_type: null,
    origin_id: null,
    origin_version: null,
    state: 'active',
    state_reason: null,
    opened_by: 'human:ana',
    created_at: at(0),
    open_questions: 0,
    last_activity: at(1),
    ...extra,
  };
}

const feature: AskSubject = {
  kind: 'record',
  type: 'fdr',
  title: 'Activity catalog',
  versionIds: ['v1', 'v2'],
  versionId: 'v2',
};
const product: AskSubject = { kind: 'product', name: 'Club Activities' };

describe('Ask DEMIURGO about this: the thread of a subject', () => {
  it('AC-INT-001-09 a record finds the active thread born from one of its versions, the most recent first', () => {
    const threads = [
      thread('other', { origin_type: 'record_version', origin_id: 'x1' }),
      thread('old', { origin_type: 'record_version', origin_id: 'v1', last_activity: at(5) }),
      thread('recent', { origin_type: 'record_version', origin_id: 'v2', last_activity: at(9) }),
      thread('closed', { origin_type: 'record_version', origin_id: 'v2', state: 'concluded', last_activity: at(30) }),
    ];
    expect(threadFor(threads, feature)?.id).toBe('recent');
    expect(
      threadFor(
        threads.filter((t) => ['other', 'closed'].includes(t.id)),
        feature,
      ),
    ).toBeUndefined();
  });

  it('AC-INT-001-09 the whole product finds an active thread about the whole product, never one born from a record', () => {
    const threads = [
      thread('about', { purpose: `${PRODUCT_PURPOSE}: pricing`, last_activity: at(3) }),
      thread('record', { purpose: PRODUCT_PURPOSE, origin_type: 'record_version', origin_id: 'v1', last_activity: at(9) }),
      thread('aside', { purpose: PRODUCT_PURPOSE, state: 'set_aside', last_activity: at(10) }),
      thread('plain', { purpose: 'Guests at activities' }),
    ];
    expect(threadFor(threads, product)?.id).toBe('about');
    expect(threadFor([], product)).toBeUndefined();
  });

  it('opens a new thread with a purpose and, for a record, the version on screen as its origin', () => {
    expect(openThreadData(feature)).toEqual({
      purpose: 'About Activity catalog',
      origin: { type: 'record_version', id: 'v2' },
    });
    expect(openThreadData(product)).toEqual({ purpose: PRODUCT_PURPOSE });
  });

  it('says what it is about in the words of each type', () => {
    expect(askPlaceholder(feature)).toBe('Ask about this feature, or suggest a change…');
    expect(askPlaceholder({ ...feature, type: 'adr' })).toBe('Ask about this tech decision, or suggest a change…');
    expect(askPlaceholder({ ...feature, type: 'decision' })).toBe('Ask about this decision, or suggest a change…');
    expect(askPlaceholder(product)).toBe('Ask or tell DEMIURGO anything about Club Activities');
  });
});

function message(id: string, author: string, minute: number): Message {
  return {
    id,
    exploration_id: 't',
    question_id: null,
    author,
    run_id: null,
    kind: null,
    body: 'text',
    state: 'posted',
    created_at: at(minute),
    epistemic_status: null,
  };
}

function detail(messages: Message[]): ExplorationDetail {
  return { ...thread('t'), messages, questions: [], children: [] };
}

function run(id: string, state: string, minute: number, extra: Partial<RunListItem> = {}): RunListItem {
  return {
    id,
    state,
    action: 'exploration_chat',
    scope: { type: 'exploration', id: 't' },
    provider: 'simulated',
    model: 'simulated',
    retry_of: null,
    failure_kind: null,
    error: null,
    requested_by: 'system:responder@1',
    created_at: at(minute),
    started_at: at(minute),
    finished_at: null,
    context_pack_hash: null,
    exploration_id: 't',
    batch_id: null,
    ...extra,
  };
}

describe('Ask DEMIURGO about this: how the answer goes', () => {
  it('is answering until its run finishes or DEMIURGO writes after the message', () => {
    expect(askProgress(undefined, undefined, 'm1')).toEqual({ state: 'answering' });
    const mine = message('m1', 'human:ana', 10);
    const earlier = message('m0', 'agent:run:r0', 5);
    expect(askProgress(detail([earlier, mine]), [run('r0', 'completed', 4)], 'm1')).toEqual({ state: 'answering' });
    expect(askProgress(detail([earlier, mine]), [run('r1', 'running', 11)], 'm1')).toEqual({ state: 'answering' });
    expect(askProgress(detail([earlier, mine, message('m2', 'agent:run:r1', 12)]), [], 'm1')).toEqual({ state: 'answered' });
    expect(askProgress(detail([earlier, mine]), [run('r1', 'completed', 11)], 'm1')).toEqual({ state: 'answered' });
  });

  it('says when the run that answers failed, in product words', () => {
    const mine = message('m1', 'human:ana', 10);
    expect(askProgress(detail([mine]), [run('r1', 'failed', 11, { failure_kind: 'invalid_output' })], 'm1')).toEqual({
      state: 'failed',
      failure: "It couldn't finish: the output didn't match the format. Nothing was changed.",
    });
    // A retry that is working again means it is answering.
    expect(askProgress(detail([mine]), [run('r1', 'failed', 11), run('r2', 'running', 12, { retry_of: 'r1' })], 'm1')).toEqual({
      state: 'answering',
    });
  });
});
