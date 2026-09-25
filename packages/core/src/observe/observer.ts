// The `Observer` port of `Services` (spec §7.1): the only way the core emits observation notes.
// Three implementations live next to this file: OTLP (the real one), memory (tests) and noop
// (`DEMIURGO_OBSERVE=off`). No method of an observer ever throws: internal failures are counted.

import type { Channel, LogName, ObserveEnvironment, TextKind } from '@demiurgo/domain';

export type AttributeValue = string | number | boolean | readonly string[] | undefined | null;
export type Attributes = Record<string, AttributeValue>;

/** Where a command enters DEMIURGO (§5.1): the root of an interaction. */
export type InteractionRoot = {
  channel: Channel;
  actor: string;
  actorType: string;
  command: string;
  projectId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  httpRoute?: string;
  /** Reuse an id instead of generating one (a request that already carries a correlation). */
  interactionId?: string;
};

export type SpanStatus = 'ok' | 'error';
export type SpanError = { type?: string; message?: string };

export type SpanHandle = {
  setAttributes(attrs: Attributes): void;
  setStatus(status: SpanStatus, error?: SpanError): void;
  /** A span link (§5.1: a retry links to the original run). */
  addLink(traceParent: string, attrs?: Attributes): void;
  /** The W3C `traceparent` of this span, for `trace_contexts` and the child CLIs. */
  traceParent(): string;
  spanId(): string;
  traceId(): string;
};

export type InteractionContext = {
  /** The interaction id: a UUID v7, also the journal's correlation. */
  id: string;
  /** The same id as an OpenTelemetry trace id (32 hex chars). */
  traceId: string;
  span: SpanHandle;
};

/** Notes lost since the pipeline last worked, and internal failures swallowed. */
export type DroppedCounts = { spans: number; logs: number; errors: number };

export type Observer = {
  /** Opens an interaction: generates the id, sets it as the trace id and runs `fn` inside. */
  interaction<T>(root: InteractionRoot, fn: (ctx: InteractionContext) => Promise<T>): Promise<T>;
  /** A span, child of the active context, or of `parent` (a traceparent from `trace_contexts`). */
  span<T>(name: string, attrs: Attributes, fn: (s: SpanHandle) => Promise<T>, parent?: string): Promise<T>;
  /** The id of the active interaction (the journal's correlation), or null outside one. */
  currentInteractionId(): string | null;
  /** The traceparent of the active span, for `trace_contexts` and the environment of the CLIs. */
  currentTraceParent(): string | null;
  /** Emits a text once per fingerprint and process; always returns the full SHA-256 hex. */
  text(kind: TextKind, body: string, attrs?: Attributes): string;
  /** A log record attached to the active span: raw provider events, manifests, journal, evaluations. */
  event(name: LogName, attrs: Attributes, body?: unknown): void;
  /** Exports what is queued, within the time limit. */
  flush(timeoutMs: number): Promise<void>;
  /** Flushes and releases the exporters; the observer emits nothing afterwards. */
  shutdown(timeoutMs: number): Promise<void>;
  /** Cumulative counts of what was lost. */
  dropped(): DroppedCounts;
  /** How this observer is configured, or null when it emits nothing (the child CLIs get no telemetry then). */
  options(): ObserveOptions | null;
};

export type ObserveMode = 'otlp' | 'off';

export type ObserveOptions = {
  mode: ObserveMode;
  /** Base URL of the OTLP/HTTP collector; `/v1/traces` and `/v1/logs` are appended. */
  endpoint: string;
  environment: ObserveEnvironment;
  serviceVersion: string;
  /** The port, or the name, of this instance (§5.6). */
  instance: string;
  /** `WORKFLOWS_VERSION` of the durable engine, when the process runs one. */
  workflowsVersion?: string;
};
