import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/api/client.ts';
import {
  KNOWLEDGE_NOT_READY,
  isKnowledgeNotReady,
  retryWhileKnowledgeBusy,
} from '../../src/api/commands.ts';

const busy = () => new ApiError(409, 'conflict', `${KNOWLEDGE_NOT_READY}: 2 update(s) are still pending.`, []);

describe('retryWhileKnowledgeBusy', () => {
  it('recognises only the 409 about knowledge', () => {
    expect(isKnowledgeNotReady(busy())).toBe(true);
    expect(isKnowledgeNotReady(new ApiError(409, 'conflict', 'x', [`${KNOWLEDGE_NOT_READY}: 1`]))).toBe(true);
    expect(isKnowledgeNotReady(new ApiError(409, 'conflict', 'Already drafting', []))).toBe(false);
    expect(isKnowledgeNotReady(new ApiError(500, 'x', KNOWLEDGE_NOT_READY, []))).toBe(false);
  });

  it('retries every 3 s until it works, flagging the wait', async () => {
    const attempt = vi.fn().mockRejectedValueOnce(busy()).mockRejectedValueOnce(busy()).mockResolvedValue('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);
    const waiting: boolean[] = [];
    await expect(retryWhileKnowledgeBusy(attempt, { sleep, onWaiting: (w) => waiting.push(w) })).resolves.toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 3000);
    expect(waiting).toEqual([true, true, false]);
  });

  it('gives up after 3 minutes with the server error', async () => {
    const attempt = vi.fn().mockRejectedValue(busy());
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(retryWhileKnowledgeBusy(attempt, { sleep })).rejects.toThrow(KNOWLEDGE_NOT_READY);
    expect(sleep).toHaveBeenCalledTimes(60);
    expect(attempt).toHaveBeenCalledTimes(61);
  });

  it('does not retry other errors', async () => {
    const other = new ApiError(409, 'conflict', 'Already drafting', []);
    const attempt = vi.fn().mockRejectedValue(other);
    const sleep = vi.fn();
    await expect(retryWhileKnowledgeBusy(attempt, { sleep })).rejects.toBe(other);
    expect(sleep).not.toHaveBeenCalled();
  });
});
