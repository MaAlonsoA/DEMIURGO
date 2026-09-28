// The dev inspector: an Alt+click lands on the closest element that names an entity, whether it
// carries an explicit data-trace or one of the markers the app already puts on its entities; and
// the trace's pieces read as they should.

import { describe, expect, it } from 'vitest';
import {
  type TraceNode,
  parseTrace,
  projectOfPath,
  stateChange,
  traceTargetOf,
  traceableStep,
} from '../../src/screens/dev/trace.ts';

const ID = '0192f1c4-7a2b-7c3d-8e4f-1a2b3c4d5e6f';
const OTHER = '0192f1c4-7a2b-7c3d-8e4f-000000000001';

/** A stand-in for a DOM element: its attributes and its parent. */
function node(attributes: Record<string, string>, parent: TraceNode | null = null): TraceNode {
  return { getAttribute: (name) => attributes[name] ?? null, parentElement: parent };
}

describe('the entity under an Alt+click', () => {
  it('is the one the clicked element names with data-trace', () => {
    expect(traceTargetOf(node({ 'data-trace': `record_version:${ID}` }))).toEqual({ type: 'record_version', id: ID });
  });

  it('is found walking up from a child that names nothing', () => {
    const section = node({ 'data-trace': `question:${ID}` });
    const text = node({}, node({ class: 'prose' }, section));
    expect(traceTargetOf(text)).toEqual({ type: 'question', id: ID });
  });

  it('is the closest one when entities nest', () => {
    const proposal = node({ 'data-trace': `proposal:${OTHER}` });
    const question = node({ 'data-trace': `question:${ID}` }, proposal);
    expect(traceTargetOf(node({}, question))).toEqual({ type: 'question', id: ID });
  });

  it("also comes from the app's own markers, which hold an entity's id", () => {
    expect(traceTargetOf(node({ 'data-question': ID }))).toEqual({ type: 'question', id: ID });
    expect(traceTargetOf(node({ 'data-proposal': ID }))).toEqual({ type: 'proposal', id: ID });
    expect(traceTargetOf(node({ 'data-run': ID }))).toEqual({ type: 'run', id: ID });
    expect(traceTargetOf(node({ 'data-message': ID }))).toEqual({ type: 'message', id: ID });
  });

  it('is nothing for a record code, an unknown type or a value that is not an id', () => {
    expect(traceTargetOf(node({ 'data-record': 'PRD-PRO-001' }))).toBeNull();
    expect(traceTargetOf(node({ 'data-trace': `glossary:${ID}` }))).toBeNull();
    expect(traceTargetOf(node({ 'data-trace': 'question:not-an-id', 'data-run': 'working' }))).toBeNull();
    expect(traceTargetOf(null)).toBeNull();
    expect(parseTrace(`:${ID}`)).toBeNull();
    expect(parseTrace(null)).toBeNull();
  });
});

describe('the pieces of a trace', () => {
  it('works only inside a project', () => {
    expect(projectOfPath(`/p/${ID}/threads`)).toBe(ID);
    expect(projectOfPath(`/p/${ID}`)).toBe(ID);
    expect(projectOfPath('/projects')).toBeNull();
    expect(projectOfPath('/p/new')).toBeNull();
  });

  it('traces a step of the origin in turn, except a context pack', () => {
    const step = { depth: 1, id: ID, label: 'x', actor: null, at: null, detail: null };
    expect(traceableStep({ ...step, type: 'run' })).toEqual({ type: 'run', id: ID });
    expect(traceableStep({ ...step, type: 'context_pack' })).toBeNull();
  });

  it('says how an event changed the state, when it did', () => {
    expect(stateChange({ state_before: 'inferred', state_after: 'confirmed' })).toBe('inferred → confirmed');
    expect(stateChange({ state_before: null, state_after: 'pending' })).toBe('∅ → pending');
    expect(stateChange({ state_before: 'pending', state_after: 'pending' })).toBe('pending');
    expect(stateChange({ state_before: null, state_after: null })).toBeNull();
  });
});
