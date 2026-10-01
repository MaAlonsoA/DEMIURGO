import { describe, expect, it } from 'vitest';
import { invalidatedBy } from '../../src/api/stream.ts';

describe('stream invalidation', () => {
  it('refreshes the state query (which carries the inception path) on stage, question, version, proposal and build events', () => {
    for (const entity of ['stage', 'question', 'record_version', 'proposal', 'batch', 'planned_feature', 'build_request', 'link', 'evidence'])
      expect(invalidatedBy(entity)).toContain('state');
  });
  it('refreshes state for an entity it does not know', () => {
    expect(invalidatedBy('something_new')).toEqual(['state']);
  });
});
