import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type PreviousBuilderAttempt, builderSessionPlan, sessionFilesExist } from '../src/build/session.ts';

const engine = { provider: 'claude', model: 'sonnet' };
const attempt = (o: Partial<PreviousBuilderAttempt> = {}): PreviousBuilderAttempt => ({ provider: 'claude', model: 'sonnet', session: { mode: 'fresh', id: 'abcdef12-0000' }, filesExist: true, ...o });

describe('builderSessionPlan', () => {
  it('starts fresh on the first attempt', () => {
    expect(builderSessionPlan([], engine).mode).toBe('fresh');
  });
  it('resumes the previous session with the same engine', () => {
    expect(builderSessionPlan([attempt()], engine)).toMatchObject({ mode: 'resumed', id: 'abcdef12-0000' });
  });
  it('starts fresh when the engine, the id or the files differ', () => {
    expect(builderSessionPlan([attempt({ model: 'opus' })], engine).mode).toBe('fresh');
    expect(builderSessionPlan([attempt({ provider: 'codex' })], engine).mode).toBe('fresh');
    expect(builderSessionPlan([attempt({ session: undefined })], engine).mode).toBe('fresh');
    expect(builderSessionPlan([attempt({ filesExist: false })], engine).mode).toBe('fresh');
  });
  it('allows two consecutive resumes and then starts fresh', () => {
    const resumed = { mode: 'resumed' as const, id: 'abcdef12-0000' };
    expect(builderSessionPlan([attempt(), attempt({ session: resumed })], engine).mode).toBe('resumed');
    expect(builderSessionPlan([attempt(), attempt({ session: resumed }), attempt({ session: resumed })], engine).mode).toBe('fresh');
    // a fresh attempt in between resets the count
    expect(builderSessionPlan([attempt({ session: resumed }), attempt({ session: resumed }), attempt()], engine).mode).toBe('resumed');
  });
});

describe('sessionFilesExist', () => {
  it('finds a session file by id, in any subfolder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dmg-sess-'));
    expect(await sessionFilesExist(dir, 'abcdef12-0000')).toBe(false);
    mkdirSync(join(dir, '-workspace'));
    writeFileSync(join(dir, '-workspace', 'abcdef12-0000.jsonl'), '{}');
    expect(await sessionFilesExist(dir, 'abcdef12-0000')).toBe(true);
    expect(await sessionFilesExist(join(dir, 'missing'), 'abcdef12-0000')).toBe(false);
  });
});
