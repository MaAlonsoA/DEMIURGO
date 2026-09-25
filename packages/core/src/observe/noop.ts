// The observer of `DEMIURGO_OBSERVE=off`: emits nothing, but an interaction still gets its UUID v7,
// so the journal's correlation works the same with observation off.

import { AsyncLocalStorage } from 'node:async_hooks';
import { sha256Hex, traceIdOf } from '@demiurgo/domain';
import { inertHandle } from './core.ts';
import { isUuid, uuidV7 } from './ids.ts';
import type { Observer } from './observer.ts';

const activeInteraction = new AsyncLocalStorage<string>();

export const noopObserver: Observer = {
  interaction(root, fn) {
    const id = root.interactionId && isUuid(root.interactionId) ? root.interactionId.toLowerCase() : uuidV7();
    const traceId = traceIdOf(id);
    return activeInteraction.run(id, () => fn({ id, traceId, span: inertHandle(traceId) }));
  },
  span(_name, _attrs, fn) {
    const id = activeInteraction.getStore();
    return fn(inertHandle(id ? traceIdOf(id) : ''));
  },
  currentInteractionId: () => activeInteraction.getStore() ?? null,
  currentTraceParent: () => null,
  text: (_kind, body) => sha256Hex(body),
  event: () => undefined,
  flush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
  dropped: () => ({ spans: 0, logs: 0, errors: 0 }),
  options: () => null,
};
