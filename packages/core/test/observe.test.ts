// The observer (spec §5.1, §6.1, §6.3, §7.1): interaction ids as trace ids, spans that hang from the
// active context or from a remote traceparent, texts once per fingerprint, and the three flavours.

import {
  ATTR,
  DomainError,
  LOG,
  OBSERVE_SCHEMA_VERSION,
  RESOURCE,
  SERVICE_NAME,
  interactionIdOf,
  traceIdOf,
} from '@demiurgo/domain';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isUuidV7, uuidV7, uuidV7Time } from '../src/observe/ids.ts';
import { createMemoryObserver, createObserver, noopObserver } from '../src/observe/index.ts';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

describe('uuidV7', () => {
  it('produces UUIDs of version 7 and variant 10, carrying the milliseconds they were made at', () => {
    const at = Date.UTC(2026, 8, 26, 12, 0, 0, 123);
    const id = uuidV7(at);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(isUuidV7(id)).toBe(true);
    expect(uuidV7Time(id)).toBe(at);
    expect(isUuidV7('8f1a2b3c-4d5e-4f60-8a1b-2c3d4e5f6a7b')).toBe(false);
  });

  it('sorts by time across milliseconds and never repeats', () => {
    const ids = [uuidV7(1000), uuidV7(1001), uuidV7(2000), uuidV7(3000)];
    expect([...ids].sort()).toEqual(ids);
    const many = new Set(Array.from({ length: 1000 }, () => uuidV7()));
    expect(many.size).toBe(1000);
  });
});

describe('memory observer', () => {
  it('an interaction is a root span whose trace id is the interaction id (a UUID v7)', async () => {
    const o = createMemoryObserver();
    let inside: string | null = null;
    const ctx = await o.interaction(
      { channel: 'api', actor: 'human:ana', actorType: 'human', command: 'project.create' },
      async (c) => {
        inside = o.currentInteractionId();
        return c;
      },
    );
    expect(isUuidV7(ctx.id)).toBe(true);
    expect(ctx.traceId).toBe(traceIdOf(ctx.id));
    expect(inside).toBe(ctx.id);
    expect(o.currentInteractionId()).toBeNull();
    expect(o.currentTraceParent()).toBeNull();
    const [root] = o.spans();
    expect(root?.name).toBe('interaction project.create');
    expect(root?.spanContext().traceId).toBe(traceIdOf(ctx.id));
    expect(root?.parentSpanContext).toBeUndefined();
    expect(root?.attributes).toMatchObject({
      [ATTR.interactionId]: ctx.id,
      [ATTR.channel]: 'api',
      [ATTR.actor]: 'human:ana',
      [ATTR.actorType]: 'human',
      [ATTR.command]: 'project.create',
    });
    expect(root?.attributes[ATTR.projectId]).toBeUndefined();
    expect(ctx.span.traceParent()).toBe(`00-${ctx.traceId}-${root?.spanContext().spanId}-01`);
  });

  it('reuses the id a request already carries', async () => {
    const o = createMemoryObserver();
    const given = '019995a0-0000-7000-8000-000000000001';
    const ctx = await o.interaction(
      { channel: 'mcp', actor: 'agent:x', actorType: 'agent', command: 'c', interactionId: given },
      async (c) => c,
    );
    expect(ctx.id).toBe(given);
    expect(o.spans()[0]?.spanContext().traceId).toBe(traceIdOf(given));
  });

  it('a nested span hangs from the root; currentTraceParent points at the innermost span', async () => {
    const o = createMemoryObserver();
    let traceParent: string | null = null;
    await o.interaction(
      { channel: 'cli', actor: 'system:cli', actorType: 'system', command: 'run.request', projectId: 'p1' },
      async (c) => {
        await o.span(
          'command run.request',
          { [ATTR.command]: 'run.request', [ATTR.reasons]: ['a', 'b'], [ATTR.entityId]: null },
          async (s) => {
            traceParent = o.currentTraceParent();
            expect(traceParent).toBe(s.traceParent());
            expect(o.currentInteractionId()).toBe(c.id);
          },
        );
      },
    );
    const [child, root] = o.spans();
    expect(root?.name).toBe('interaction run.request');
    expect(root?.attributes[ATTR.projectId]).toBe('p1');
    expect(child?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId);
    expect(child?.spanContext().traceId).toBe(root?.spanContext().traceId);
    expect(child?.attributes[ATTR.reasons]).toEqual(['a', 'b']);
    expect(child?.attributes).not.toHaveProperty(ATTR.entityId);
    expect(traceParent).toBe(`00-${child?.spanContext().traceId}-${child?.spanContext().spanId}-01`);
    expect(child?.status.code).toBe(1); // OK
  });

  it('a span with an explicit traceparent hangs from that remote span, even from another interaction', async () => {
    const o = createMemoryObserver();
    const parent = await o.interaction(
      { channel: 'api', actor: 'human:ana', actorType: 'human', command: 'message.send' },
      async () => o.span('command message.send', {}, async (s) => s.traceParent()),
    );
    await o.interaction({ channel: 'system', actor: 'system:engine', actorType: 'system', command: 'reconcile' }, async () => {
      await o.span(
        'run.prepare',
        { [ATTR.runId]: 'r1' },
        async (s) => {
          expect(s.traceParent().startsWith(`00-${parent.split('-')[1]}-`)).toBe(true);
          expect(o.currentInteractionId()).toBe(interactionIdOf(parent.split('-')[1] ?? ''));
        },
        parent,
      );
    });
    const step = o.spans().find((s) => s.name === 'run.prepare');
    const command = o.spans().find((s) => s.name === 'command message.send');
    expect(step?.parentSpanContext?.spanId).toBe(command?.spanContext().spanId);
    expect(step?.parentSpanContext?.isRemote).toBe(true);
    expect(step?.spanContext().traceId).toBe(command?.spanContext().traceId);
  });

  it('a malformed traceparent is ignored: the span hangs from the active context', async () => {
    const o = createMemoryObserver();
    await o.interaction({ channel: 'api', actor: 'a', actorType: 'human', command: 'c' }, async () => {
      await o.span('child', {}, async () => undefined, 'not-a-traceparent');
    });
    const [child, root] = o.spans();
    expect(child?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId);
  });

  it('an error thrown inside marks the span as failed with error.type and error.message, and is rethrown', async () => {
    const o = createMemoryObserver();
    await expect(
      o.interaction({ channel: 'api', actor: 'a', actorType: 'human', command: 'c' }, async () => {
        await o.span('command c', {}, async () => {
          throw new DomainError('forbidden', 'Not yours.');
        });
      }),
    ).rejects.toThrow('Not yours.');
    const [child, root] = o.spans();
    expect(child?.status).toEqual({ code: 2, message: 'Not yours.' });
    expect(child?.attributes).toMatchObject({ [ATTR.errorType]: 'forbidden', [ATTR.errorMessage]: 'Not yours.' });
    expect(root?.status.code).toBe(2);
    expect(root?.attributes[ATTR.errorType]).toBe('forbidden');
    await expect(
      o.span('alone', {}, async () => {
        throw new TypeError('bad');
      }),
    ).rejects.toThrow('bad');
    expect(o.spans().at(-1)?.attributes[ATTR.errorType]).toBe('TypeError');
  });

  it('a status the handle set explicitly is kept', async () => {
    const o = createMemoryObserver();
    await o.span('command c', {}, async (s) => {
      s.setStatus('error', { type: 'guard', message: 'Blocked.' });
      s.setAttributes({ [ATTR.outcome]: 'guard' });
    });
    const [span] = o.spans();
    expect(span?.status).toEqual({ code: 2, message: 'Blocked.' });
    expect(span?.attributes).toMatchObject({ [ATTR.errorType]: 'guard', [ATTR.outcome]: 'guard' });
  });

  it('a link joins a span to a finished one (a retry to its original run)', async () => {
    const o = createMemoryObserver();
    const original = await o.span('run.invoke', {}, async (s) => s.traceParent());
    await o.span('run.invoke', {}, async (s) => s.addLink(original, { [ATTR.retryOf]: 'r1' }));
    const [, retry] = o.spans();
    expect(retry?.links[0]?.context.spanId).toBe(original.split('-')[2]);
    expect(retry?.links[0]?.attributes).toEqual({ [ATTR.retryOf]: 'r1' });
  });

  it('text emits one log record per distinct body, attached to the active span, and returns the sha256', async () => {
    const o = createMemoryObserver();
    const body = 'You are the classifier.';
    let hashes: string[] = [];
    let spanId = '';
    await o.interaction({ channel: 'api', actor: 'a', actorType: 'human', command: 'c' }, async (c) => {
      spanId = c.span.spanId();
      hashes = [o.text('system_prompt', body), o.text('system_prompt', body), o.text('input', 'other', { [ATTR.callId]: 'k1' })];
    });
    expect(hashes[0]).toBe(sha256(body));
    expect(hashes[1]).toBe(hashes[0]);
    expect(hashes[2]).toBe(sha256('other'));
    const logs = o.logs();
    expect(logs).toHaveLength(2);
    expect(logs[0]?.eventName).toBe(LOG.text);
    expect(logs[0]?.body).toBe(body);
    expect(logs[0]?.attributes).toMatchObject({
      [ATTR.textHash]: hashes[0],
      [ATTR.textKind]: 'system_prompt',
      [ATTR.textChars]: body.length,
      'event.name': LOG.text,
    });
    expect(logs[0]?.spanContext?.spanId).toBe(spanId);
    expect(logs[1]?.attributes).toMatchObject({ [ATTR.textKind]: 'input', [ATTR.callId]: 'k1' });
    // After a reset the same text is new again.
    o.reset();
    o.text('system_prompt', body);
    expect(o.logs()).toHaveLength(1);
  });

  it('event emits a log record with the name, the serialized body and the active trace id', async () => {
    const o = createMemoryObserver();
    let traceId = '';
    await o.interaction({ channel: 'api', actor: 'a', actorType: 'human', command: 'c' }, async (c) => {
      traceId = c.traceId;
      o.event(LOG.journal, { [ATTR.eventSeq]: 7, [ATTR.command]: 'c' }, { before: null, after: { a: 1 } });
      o.event(LOG.providerEvent, { [ATTR.eventSeq]: 1 }, '{"raw":true}');
      o.event(LOG.evaluation, { [ATTR.evaluationName]: 'x' });
    });
    const [journal, raw, evaluation] = o.logs();
    expect(journal?.eventName).toBe(LOG.journal);
    expect(journal?.attributes).toMatchObject({ 'event.name': LOG.journal, [ATTR.eventSeq]: 7 });
    expect(journal?.body).toBe('{"before":null,"after":{"a":1}}');
    expect(journal?.spanContext?.traceId).toBe(traceId);
    expect(raw?.body).toBe('{"raw":true}');
    expect(evaluation?.body).toBeUndefined();
  });

  it('every note carries the resource labels of §5.6', async () => {
    const o = createMemoryObserver({ environment: 'qa', serviceVersion: 'abc123', instance: '8101', workflowsVersion: 'wf-1' });
    await o.span('command c', {}, async () => o.event(LOG.journal, {}));
    const expected = {
      [RESOURCE.serviceName]: SERVICE_NAME,
      [RESOURCE.serviceVersion]: 'abc123',
      [RESOURCE.environment]: 'qa',
      [RESOURCE.instance]: '8101',
      [RESOURCE.schemaVersion]: OBSERVE_SCHEMA_VERSION,
      [RESOURCE.workflowsVersion]: 'wf-1',
    };
    expect(o.spans()[0]?.resource.attributes).toMatchObject(expected);
    expect(o.logs()[0]?.resource.attributes).toMatchObject(expected);
  });

  it('toOtlpJson serializes what the exporter would send, with the trace id in hex', async () => {
    const o = createMemoryObserver();
    const ctx = await o.interaction({ channel: 'api', actor: 'a', actorType: 'human', command: 'c' }, async (c) => {
      o.text('input', 'hello');
      return c;
    });
    const { traces, logs } = o.toOtlpJson() as {
      traces: {
        resourceSpans: {
          resource: { attributes: { key: string }[] };
          scopeSpans: { spans: { traceId: string; name: string }[] }[];
        }[];
      };
      logs: {
        resourceLogs: { scopeLogs: { logRecords: { traceId: string; eventName?: string; body: { stringValue: string } }[] }[] }[];
      };
    };
    const span = traces.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(span?.traceId).toBe(ctx.traceId);
    expect(span?.name).toBe('interaction c');
    expect(traces.resourceSpans[0]?.resource.attributes.map((a) => a.key)).toContain(RESOURCE.schemaVersion);
    const record = logs.resourceLogs[0]?.scopeLogs[0]?.logRecords[0];
    expect(record?.traceId).toBe(ctx.traceId);
    expect(record?.body).toEqual({ stringValue: 'hello' });
  });

  it('never throws and counts nothing dropped when the pipeline works', async () => {
    const o = createMemoryObserver();
    await o.flush(100);
    expect(o.dropped()).toEqual({ spans: 0, logs: 0, errors: 0 });
    // Two observers in one process: the global context manager is installed once and shared.
    const other = createMemoryObserver();
    await other.interaction({ channel: 'api', actor: 'a', actorType: 'human', command: 'c' }, async (c) => {
      expect(other.currentInteractionId()).toBe(c.id);
    });
    expect(other.spans()).toHaveLength(1);
    expect(o.spans()).toHaveLength(0);
  });
});

describe('noop observer', () => {
  it('emits nothing but still yields a UUID v7 and the interaction id inside', async () => {
    let inside: string | null = null;
    const ctx = await noopObserver.interaction({ channel: 'api', actor: 'a', actorType: 'human', command: 'c' }, async (c) => {
      inside = noopObserver.currentInteractionId();
      await noopObserver.span('command c', {}, async (s) => {
        s.setStatus('ok');
        expect(s.traceId()).toBe(c.traceId);
      });
      return c;
    });
    expect(isUuidV7(ctx.id)).toBe(true);
    expect(inside).toBe(ctx.id);
    expect(ctx.traceId).toBe(traceIdOf(ctx.id));
    expect(noopObserver.currentInteractionId()).toBeNull();
    expect(noopObserver.currentTraceParent()).toBeNull();
    expect(noopObserver.text('input', 'hello')).toBe(sha256('hello'));
    expect(noopObserver.dropped()).toEqual({ spans: 0, logs: 0, errors: 0 });
  });

  it('is what DEMIURGO_OBSERVE=off selects', () => {
    const off = createObserver(
      { mode: 'off', endpoint: 'http://127.0.0.1:4318', environment: 'test', serviceVersion: 'x', instance: '1' },
      {
        info: () => undefined,
        error: () => undefined,
      },
    );
    expect(off).toBe(noopObserver);
  });
});
