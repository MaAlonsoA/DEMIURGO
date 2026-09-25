// The observer on the OpenTelemetry SDK, shared by the OTLP and the memory implementations: the
// same tracer, logger, resource and id generator, parameterized by the exporters. What the memory
// observer records is exactly what the OTLP one would send.

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  type Attributes as OtelAttributes,
  type Context,
  type Span,
  type SpanContext,
  SpanStatusCode,
  TraceFlags,
  context,
  isSpanContextValid,
  trace,
} from '@opentelemetry/api';
import { type LogAttributes, type Logger as OtelLogger, SeverityNumber } from '@opentelemetry/api-logs';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { type Resource, resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchLogRecordProcessor,
  type LogRecordExporter,
  type LogRecordProcessor,
  LoggerProvider,
  type ReadableLogRecord,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import {
  AlwaysOnSampler,
  BasicTracerProvider,
  BatchSpanProcessor,
  type IdGenerator,
  RandomIdGenerator,
  type ReadableSpan,
  SimpleSpanProcessor,
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  ATTR,
  DomainError,
  LOG,
  type LogName,
  OBSERVE_SCHEMA_VERSION,
  RESOURCE,
  SERVICE_NAME,
  SPAN,
  type TextKind,
  formatTraceParent,
  interactionIdOf,
  parseTraceParent,
  sha256Hex,
  traceIdOf,
} from '@demiurgo/domain';
import type { Logger } from '../services.ts';
import { isUuid, uuidV7 } from './ids.ts';
import type {
  Attributes,
  DroppedCounts,
  InteractionContext,
  ObserveOptions,
  Observer,
  SpanError,
  SpanHandle,
  SpanStatus,
} from './observer.ts';

// The bounded queues of §14.1.
export const SPAN_QUEUE = {
  maxQueueSize: 4096,
  scheduledDelayMillis: 2000,
  maxExportBatchSize: 512,
  exportTimeoutMillis: 10_000,
};
export const LOG_QUEUE = { maxQueueSize: 8192, scheduledDelayMillis: 2000, maxExportBatchSize: 512, exportTimeoutMillis: 10_000 };
/** Texts emitted once per fingerprint and process (§6.3). */
export const TEXT_CACHE_SIZE = 10_000;
/** The API's logger writes one line per minute while notes keep being dropped (§14.1). */
export const DROP_LOG_INTERVAL_MS = 60_000;

// OpenTelemetry's own attribute for the name of a log record (semantic conventions, `event.name`).
const EVENT_NAME_ATTRIBUTE = 'event.name';
// `ExportResult.code` of the SDK: 0 is SUCCESS, anything else FAILED.
const EXPORT_SUCCESS = 0;
const exportSucceeded = (result: { code: number }): boolean => result.code === EXPORT_SUCCESS;

// ---------------------------------------------------------------------------------------------
// Global context manager: "first one wins" in the API, so it is installed once per process and
// reused when another module (or another observer in the same test process) already did.

let contextManagerInstalled = false;

export function ensureContextManager(): void {
  if (contextManagerInstalled) return;
  const manager = new AsyncLocalStorageContextManager();
  manager.enable();
  if (!context.setGlobalContextManager(manager)) manager.disable();
  contextManagerInstalled = true;
}

// ---------------------------------------------------------------------------------------------
// The interaction id becomes the trace id: the root span of an interaction is started while the
// pending id sits in this storage, and the id generator takes it from there (§5.1).

const pendingTraceIds = new AsyncLocalStorage<string>();

export function interactionIdGenerator(): IdGenerator {
  const random = new RandomIdGenerator();
  return {
    generateTraceId: () => pendingTraceIds.getStore() ?? random.generateTraceId(),
    generateSpanId: () => random.generateSpanId(),
  };
}

export function buildResource(options: ObserveOptions): Resource {
  return resourceFromAttributes({
    [RESOURCE.serviceName]: SERVICE_NAME,
    [RESOURCE.serviceVersion]: options.serviceVersion,
    [RESOURCE.environment]: options.environment,
    [RESOURCE.instance]: options.instance,
    [RESOURCE.schemaVersion]: OBSERVE_SCHEMA_VERSION,
    ...(options.workflowsVersion ? { [RESOURCE.workflowsVersion]: options.workflowsVersion } : {}),
  });
}

// ---------------------------------------------------------------------------------------------
// Attributes: nulls and undefineds are dropped, readonly lists copied.

export function cleanAttributes(attrs: Attributes | undefined): OtelAttributes & LogAttributes {
  const out: Record<string, string | number | boolean | string[]> = {};
  if (!attrs) return out;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    out[key] = Array.isArray(value) ? [...value] : (value as string | number | boolean);
  }
  return out;
}

/** `error.type` of a failure (§6.1): the type of a DomainError, a `code`, or the class name. */
export function errorTypeOf(error: unknown): string {
  if (error instanceof DomainError) return error.type;
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
    if (error instanceof Error) return error.constructor.name;
  }
  return typeof error;
}

export function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// ---------------------------------------------------------------------------------------------
// Drop accounting (§14.1). The SDK drops silently when a queue is full and when an export fails;
// this ledger sees both through wrappers around the processors and the exporters, remembers the
// episode, and reports it (`demiurgo.observe.dropped`) the next time an export goes through.

type Signal = 'spans' | 'logs';

class DropLedger {
  readonly totals: DroppedCounts = { spans: 0, logs: 0, errors: 0 };
  private readonly episode = { spans: 0, logs: 0 };
  private since: string | null = null;
  private lastLogged = 0;
  // Per signal: notes handed to the processor minus notes the exporter received ≈ queue length.
  private readonly queued: Record<Signal, { submitted: number; handed: number }> = {
    spans: { submitted: 0, handed: 0 },
    logs: { submitted: 0, handed: 0 },
  };

  private readonly logger: Logger;
  private readonly clock: () => Date;
  private readonly report: (attrs: Attributes) => void;

  constructor(logger: Logger, clock: () => Date, report: (attrs: Attributes) => void) {
    this.logger = logger;
    this.clock = clock;
    this.report = report;
  }

  /** Whether the processor of `signal` would drop one more note now. */
  queueFull(signal: Signal, maxQueueSize: number): boolean {
    const q = this.queued[signal];
    if (q.handed > q.submitted) q.submitted = q.handed;
    return q.submitted - q.handed >= maxQueueSize;
  }

  submitted(signal: Signal): void {
    this.queued[signal].submitted += 1;
  }

  handed(signal: Signal, count: number): void {
    this.queued[signal].handed += count;
  }

  /** After a flush the queues are empty: the estimate starts again from the truth. */
  drained(signal: Signal): void {
    const q = this.queued[signal];
    q.submitted = q.handed;
  }

  dropped(signal: Signal, count: number): void {
    this.totals[signal] += count;
    this.episode[signal] += count;
    if (this.since === null) this.since = this.clock().toISOString();
    const now = this.clock().getTime();
    if (now - this.lastLogged >= DROP_LOG_INTERVAL_MS) {
      this.lastLogged = now;
      this.logger.error('Observation notes dropped', { spans: this.episode.spans, logs: this.episode.logs, since: this.since });
    }
  }

  failure(): void {
    this.totals.errors += 1;
  }

  /** An export succeeded: if notes were lost meanwhile, say so once, through the pipeline itself. */
  recovered(): void {
    if (this.since === null) return;
    const attrs: Attributes = {
      [ATTR.droppedSpans]: this.episode.spans,
      [ATTR.droppedLogs]: this.episode.logs,
      [ATTR.droppedSince]: this.since,
    };
    this.since = null;
    this.episode.spans = 0;
    this.episode.logs = 0;
    this.lastLogged = 0;
    this.report(attrs);
  }
}

type ExportCallback = (result: { code: number; error?: Error }) => void;

function trackingSpanExporter(inner: SpanExporter, ledger: DropLedger): SpanExporter {
  return {
    export(spans, resultCallback: ExportCallback) {
      ledger.handed('spans', spans.length);
      inner.export(spans, (result) => {
        if (exportSucceeded(result)) ledger.recovered();
        else ledger.dropped('spans', spans.length);
        resultCallback(result);
      });
    },
    shutdown: () => inner.shutdown(),
    forceFlush: () => inner.forceFlush?.() ?? Promise.resolve(),
  };
}

function trackingLogExporter(inner: LogRecordExporter, ledger: DropLedger): LogRecordExporter {
  return {
    export(logs, resultCallback: ExportCallback) {
      ledger.handed('logs', logs.length);
      inner.export(logs, (result) => {
        if (exportSucceeded(result)) ledger.recovered();
        else ledger.dropped('logs', logs.length);
        resultCallback(result);
      });
    },
    shutdown: () => inner.shutdown(),
    forceFlush: () => inner.forceFlush?.() ?? Promise.resolve(),
  };
}

function guardedSpanProcessor(inner: SpanProcessor, maxQueueSize: number, ledger: DropLedger): SpanProcessor {
  return {
    onStart: (span, parentContext) => inner.onStart(span, parentContext),
    onEnd: (span) => {
      if (ledger.queueFull('spans', maxQueueSize)) ledger.dropped('spans', 1);
      else ledger.submitted('spans');
      inner.onEnd(span);
    },
    forceFlush: () => inner.forceFlush().then(() => ledger.drained('spans')),
    shutdown: () => inner.shutdown(),
  };
}

function guardedLogProcessor(inner: LogRecordProcessor, maxQueueSize: number, ledger: DropLedger): LogRecordProcessor {
  return {
    onEmit: (record, ctx) => {
      if (ledger.queueFull('logs', maxQueueSize)) ledger.dropped('logs', 1);
      else ledger.submitted('logs');
      inner.onEmit(record, ctx);
    },
    forceFlush: () => inner.forceFlush().then(() => ledger.drained('logs')),
    shutdown: () => inner.shutdown(),
  };
}

// ---------------------------------------------------------------------------------------------

export type SdkObserverOptions = {
  options: ObserveOptions;
  logger: Logger;
  clock?: () => Date;
  spanExporter: SpanExporter;
  logExporter: LogRecordExporter;
  /** Batch processors with the bounded queues of §14.1; otherwise simple ones (tests). */
  batch: boolean;
};

export type SdkObserver = Observer & {
  readonly tracerProvider: BasicTracerProvider;
  readonly loggerProvider: LoggerProvider;
  /** Forgets which texts were already emitted. */
  resetTextCache(): void;
};

export type { ReadableLogRecord, ReadableSpan };

export function createSdkObserver(deps: SdkObserverOptions): SdkObserver {
  ensureContextManager();
  const { logger } = deps;
  const clock = deps.clock ?? (() => new Date());
  const resource = buildResource(deps.options);
  let otelLogger: OtelLogger | null = null;
  const ledger = new DropLedger(logger, clock, (attrs) => {
    otelLogger?.emit({
      eventName: LOG.dropped,
      severityNumber: SeverityNumber.WARN,
      attributes: { [EVENT_NAME_ATTRIBUTE]: LOG.dropped, ...cleanAttributes(attrs) },
    });
  });

  const spanExporter = trackingSpanExporter(deps.spanExporter, ledger);
  const logExporter = trackingLogExporter(deps.logExporter, ledger);
  const spanProcessor = deps.batch
    ? guardedSpanProcessor(new BatchSpanProcessor(spanExporter, SPAN_QUEUE), SPAN_QUEUE.maxQueueSize, ledger)
    : guardedSpanProcessor(new SimpleSpanProcessor(spanExporter), Number.POSITIVE_INFINITY, ledger);
  const logProcessor = deps.batch
    ? guardedLogProcessor(new BatchLogRecordProcessor({ exporter: logExporter, ...LOG_QUEUE }), LOG_QUEUE.maxQueueSize, ledger)
    : guardedLogProcessor(new SimpleLogRecordProcessor({ exporter: logExporter }), Number.POSITIVE_INFINITY, ledger);

  const tracerProvider = new BasicTracerProvider({
    resource,
    idGenerator: interactionIdGenerator(),
    sampler: new AlwaysOnSampler(),
    spanProcessors: [spanProcessor],
  });
  const loggerProvider = new LoggerProvider({ resource, processors: [logProcessor] });
  const tracer = tracerProvider.getTracer(SERVICE_NAME, String(OBSERVE_SCHEMA_VERSION));
  otelLogger = loggerProvider.getLogger(SERVICE_NAME, String(OBSERVE_SCHEMA_VERSION));
  const emitter = otelLogger;

  let emittedTexts = new Set<string>();
  let closed = false;

  const swallow = (what: string, error: unknown): void => {
    ledger.failure();
    try {
      logger.error(`Observer failed: ${what}`, { error: String(error) });
    } catch {
      // Nothing left to tell.
    }
  };

  const handleOf = (span: Span): SpanHandle & { statusSet: boolean } => {
    const handle = {
      statusSet: false,
      setAttributes(attrs: Attributes) {
        try {
          span.setAttributes(cleanAttributes(attrs));
        } catch (e) {
          swallow('setAttributes', e);
        }
      },
      setStatus(status: SpanStatus, error?: SpanError) {
        try {
          handle.statusSet = true;
          if (status === 'ok') {
            span.setStatus({ code: SpanStatusCode.OK });
            return;
          }
          span.setStatus({ code: SpanStatusCode.ERROR, ...(error?.message ? { message: error.message } : {}) });
          span.setAttributes(cleanAttributes({ [ATTR.errorType]: error?.type, [ATTR.errorMessage]: error?.message }));
        } catch (e) {
          swallow('setStatus', e);
        }
      },
      addLink(traceParent: string, attrs?: Attributes) {
        try {
          const target = remoteSpanContext(traceParent);
          if (target) span.addLink({ context: target, attributes: cleanAttributes(attrs) });
        } catch (e) {
          swallow('addLink', e);
        }
      },
      traceParent: () => formatTraceParent(span.spanContext().traceId, span.spanContext().spanId),
      spanId: () => span.spanContext().spanId,
      traceId: () => span.spanContext().traceId,
    };
    return handle;
  };

  const fail = (span: Span, handle: { statusSet: boolean }, error: unknown): void => {
    try {
      if (error instanceof Error) span.recordException(error);
      const message = errorMessageOf(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.setAttributes({ [ATTR.errorType]: errorTypeOf(error), [ATTR.errorMessage]: message });
      handle.statusSet = true;
    } catch (e) {
      swallow('recording an error', e);
    }
  };

  /** Runs `fn` with the span active; the status follows the outcome unless `fn` set one itself. */
  const runWithSpan = async <T>(span: Span, fn: (s: SpanHandle) => Promise<T>): Promise<T> => {
    const handle = handleOf(span);
    try {
      const result = await context.with(trace.setSpan(context.active(), span), () => fn(handle));
      if (!handle.statusSet) span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      fail(span, handle, error);
      throw error;
    } finally {
      try {
        span.end();
      } catch (e) {
        swallow('ending a span', e);
      }
    }
  };

  const observer: SdkObserver = {
    tracerProvider,
    loggerProvider,
    resetTextCache: () => {
      emittedTexts = new Set();
    },

    async interaction(root, fn) {
      const id = root.interactionId && isUuid(root.interactionId) ? root.interactionId.toLowerCase() : uuidV7(clock().getTime());
      const traceId = traceIdOf(id);
      let span: Span;
      try {
        const attributes = cleanAttributes({
          [ATTR.interactionId]: id,
          [ATTR.channel]: root.channel,
          [ATTR.actor]: root.actor,
          [ATTR.actorType]: root.actorType,
          [ATTR.projectId]: root.projectId,
          [ATTR.command]: root.command,
          [ATTR.entityType]: root.entityType,
          [ATTR.entityId]: root.entityId,
          [ATTR.httpRoute]: root.httpRoute,
        });
        span = pendingTraceIds.run(traceId, () =>
          tracer.startSpan(`${SPAN.interaction} ${root.command}`, { root: true, attributes }),
        );
      } catch (e) {
        swallow('opening an interaction', e);
        return fn({ id, traceId, span: inertHandle(traceId) });
      }
      const ctx: InteractionContext = { id, traceId, span: handleOf(span) };
      return runWithSpan(span, () => fn(ctx));
    },

    async span(name, attrs, fn, parent) {
      let span: Span;
      try {
        let ctx: Context = context.active();
        if (parent) {
          const remote = remoteSpanContext(parent);
          if (remote) ctx = trace.setSpanContext(ctx, remote);
        }
        span = tracer.startSpan(name, { attributes: cleanAttributes(attrs) }, ctx);
      } catch (e) {
        swallow(`opening span ${name}`, e);
        return fn(inertHandle(activeSpanContext()?.traceId ?? ''));
      }
      return runWithSpan(span, fn);
    },

    currentInteractionId() {
      try {
        const sc = activeSpanContext();
        return sc ? interactionIdOf(sc.traceId) : null;
      } catch (e) {
        swallow('currentInteractionId', e);
        return null;
      }
    },

    currentTraceParent() {
      try {
        const sc = activeSpanContext();
        return sc ? formatTraceParent(sc.traceId, sc.spanId, (sc.traceFlags & TraceFlags.SAMPLED) !== 0) : null;
      } catch (e) {
        swallow('currentTraceParent', e);
        return null;
      }
    },

    text(kind: TextKind, body: string, attrs?: Attributes) {
      const hash = sha256Hex(body);
      try {
        if (closed || emittedTexts.has(hash)) return hash;
        emittedTexts.add(hash);
        if (emittedTexts.size > TEXT_CACHE_SIZE) {
          const oldest = emittedTexts.values().next().value;
          if (oldest !== undefined) emittedTexts.delete(oldest);
        }
        emitter.emit({
          eventName: LOG.text,
          severityNumber: SeverityNumber.INFO,
          body,
          context: context.active(),
          attributes: {
            [EVENT_NAME_ATTRIBUTE]: LOG.text,
            ...cleanAttributes(attrs),
            [ATTR.textHash]: hash,
            [ATTR.textKind]: kind,
            [ATTR.textChars]: body.length,
          },
        });
      } catch (e) {
        swallow('emitting a text', e);
      }
      return hash;
    },

    event(name: LogName, attrs: Attributes, body?: unknown) {
      try {
        if (closed) return;
        emitter.emit({
          eventName: name,
          severityNumber: SeverityNumber.INFO,
          ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
          context: context.active(),
          attributes: { [EVENT_NAME_ATTRIBUTE]: name, ...cleanAttributes(attrs) },
        });
      } catch (e) {
        swallow(`emitting ${name}`, e);
      }
    },

    async flush(timeoutMs) {
      await withTimeout(
        Promise.all([
          tracerProvider.forceFlush({ timeoutMillis: timeoutMs }),
          loggerProvider.forceFlush({ timeoutMillis: timeoutMs }),
        ]),
        timeoutMs,
      ).catch((e: unknown) => swallow('flush', e));
    },

    async shutdown(timeoutMs) {
      if (closed) return;
      closed = true;
      await withTimeout(Promise.all([tracerProvider.shutdown(), loggerProvider.shutdown()]), timeoutMs).catch((e: unknown) =>
        swallow('shutdown', e),
      );
    },

    dropped: () => ({ ...ledger.totals }),
    options: () => deps.options,
  };
  return observer;
}

/** The span context of the active context, when there is a valid one. */
function activeSpanContext(): SpanContext | null {
  const sc = trace.getSpanContext(context.active());
  return sc && isSpanContextValid(sc) ? sc : null;
}

/** A remote span context (`isRemote`) out of a W3C traceparent, or null when malformed. */
export function remoteSpanContext(traceParent: string): SpanContext | null {
  const parsed = parseTraceParent(traceParent);
  if (!parsed) return null;
  const sc: SpanContext = {
    traceId: parsed.traceId,
    spanId: parsed.spanId,
    traceFlags: (Number.parseInt(parsed.flags, 16) & TraceFlags.SAMPLED) !== 0 ? TraceFlags.SAMPLED : TraceFlags.NONE,
    isRemote: true,
  };
  return isSpanContextValid(sc) ? sc : null;
}

/** A span id no real span has: the handle of a span that was never opened. */
export const INERT_SPAN_ID = '0'.repeat(16);

/** A handle that records nothing (the noop observer, or a span the SDK failed to open). */
export function inertHandle(traceId: string): SpanHandle {
  return {
    setAttributes: () => undefined,
    setStatus: () => undefined,
    addLink: () => undefined,
    traceParent: () => formatTraceParent(traceId, INERT_SPAN_ID),
    spanId: () => INERT_SPAN_ID,
    traceId: () => traceId,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
    timer.unref();
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}
