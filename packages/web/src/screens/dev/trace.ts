// Logic of the dev inspector (only with DEMIURGO_DEV_TOOLS=1): which entity an Alt+click lands on,
// and the shape of its trace as GET /api/dev/trace returns it (core/queries/trace.ts). Pure.

export const TRACE_TYPES = [
  'record',
  'record_version',
  'question',
  'message',
  'proposal',
  'batch',
  'run',
  'exploration',
] as const;
export type TraceType = (typeof TRACE_TYPES)[number];

export type TraceTarget = { type: TraceType; id: string };

/** One step of the origin chain; `depth` nests what a step comes from under it. */
export type TraceStep = {
  depth: number;
  type: TraceType | 'context_pack';
  id: string;
  label: string;
  actor: string | null;
  at: string | null;
  detail: string | null;
};

export type TraceEvent = {
  seq: number;
  at: string;
  actor: string;
  command: string;
  entity_type: string;
  state_before: string | null;
  state_after: string | null;
  after: unknown;
  cause: unknown;
};

export type TraceReader = {
  pack_id: string;
  role: string;
  created_at: string;
  version: number | null;
  runs: { id: string; action: string; state: string }[];
};

export type Trace = {
  entity: { type: TraceType; id: string; row: Record<string, unknown> };
  origin: TraceStep[];
  events: TraceEvent[];
  /** Which context packs carried it. `tracked: false` when packs don't keep this kind of entity by id. */
  read_by: { tracked: boolean; packs: TraceReader[] };
};

/** What an element needs for the walk up: a DOM element, or a stand-in in the tests. */
export type TraceNode = { getAttribute(name: string): string | null; parentElement: TraceNode | null };

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isTraceType = (t: string): t is TraceType => (TRACE_TYPES as readonly string[]).includes(t);

/** Markers the app already puts on its entities, each holding the entity's id. */
const MARKERS: readonly [attribute: string, type: TraceType][] = [
  ['data-question', 'question'],
  ['data-proposal', 'proposal'],
  ['data-run', 'run'],
  ['data-message', 'message'],
];

/** `<type>:<uuid>`, or null when it isn't one. */
export function parseTrace(value: string | null): TraceTarget | null {
  if (!value) return null;
  const i = value.indexOf(':');
  const type = value.slice(0, i);
  const id = value.slice(i + 1);
  return i > 0 && isTraceType(type) && RE_UUID.test(id) ? { type, id } : null;
}

/** The entity of the closest element (the clicked one or an ancestor) that names one, or null. */
export function traceTargetOf(el: TraceNode | null): TraceTarget | null {
  for (let node = el; node; node = node.parentElement) {
    const traced = parseTrace(node.getAttribute('data-trace'));
    if (traced) return traced;
    for (const [attribute, type] of MARKERS) {
      const id = node.getAttribute(attribute);
      if (id && RE_UUID.test(id)) return { type, id };
    }
  }
  return null;
}

/** The project of the page shown now (`/p/<id>/…`), or null outside a project. */
export function projectOfPath(pathname: string): string | null {
  const id = /^\/p\/([^/]+)/.exec(pathname)?.[1] ?? '';
  return RE_UUID.test(id) ? id : null;
}

/** A step of the origin that can be traced in turn (a context pack can't: it has no trace of its own). */
export function traceableStep(step: TraceStep): TraceTarget | null {
  return step.type !== 'context_pack' && RE_UUID.test(step.id) ? { type: step.type, id: step.id } : null;
}

/** The raw row, readable: indented JSON. */
export const rowText = (row: Record<string, unknown>): string => JSON.stringify(row, null, 2);

/** The state change of an event, when it has one ("pending → confirmed"). */
export function stateChange(e: Pick<TraceEvent, 'state_before' | 'state_after'>): string | null {
  if (!e.state_before && !e.state_after) return null;
  if (e.state_before === e.state_after) return e.state_after;
  return `${e.state_before ?? '∅'} → ${e.state_after ?? '∅'}`;
}
