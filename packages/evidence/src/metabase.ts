// `pnpm evidence metabase-setup` (spec §12, §15.3): leaves the Metabase of compose.evidence.yaml ready
// through its REST API, idempotently. The first run creates the admin account (evidence@demiurgo.local, with
// METABASE_ADMIN_PASSWORD from packages/evidence/.env); every run then signs in and makes sure of: the
// read-only connection "DEMIURGO evidence" to demiurgo_evidence as evidence_reader, no sample database,
// the collection "DEMIURGO", one native SQL question per saved question of `questions/` that the
// dashboard uses (the seven of §15.3) plus session-reuse, context-of-run and tokens-by-engine, and the
// dashboard "DEMIURGO · primer cuadro" with the seven cards on a grid. Everything is matched by name, so
// re-running updates instead of duplicating. At the end it runs every card once and reports the rows.
//
// API of the pinned version (v0.63): `/api/setup` with the setup token from `/api/session/properties`,
// `/api/session`, `/api/database`, `/api/collection`, `/api/card` (`dataset_query.native` with
// `template-tags`), `/api/dashboard/:id` (`dashcards` replaces the whole set; a negative id is a new one)
// and `/api/card/:id/query`.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { QUESTIONS_DIR } from './ask.ts';
import { ENV_FILE, parseEnvFile } from './up.ts';

export const DEFAULT_METABASE_URL = 'http://127.0.0.1:3300';
export const ADMIN_EMAIL = 'evidence@demiurgo.local';
export const DATABASE_NAME = 'DEMIURGO evidence';
export const COLLECTION_NAME = 'DEMIURGO';
export const DASHBOARD_NAME = 'DEMIURGO · primer cuadro';
/** Width of the Metabase dashboard grid. */
export const GRID_WIDTH = 24;
/** The value of a `run` tag before the person picks one: a run that does not exist, so the card runs empty. */
export const NO_RUN = '00000000-0000-0000-0000-000000000000';

/** The connection Metabase uses: the compose network name of the postgres and the read-only role of init.sql. */
export const DATABASE_DETAILS = {
  host: 'postgres',
  port: 5432,
  dbname: 'demiurgo_evidence',
  user: 'evidence_reader',
  password: 'evidence-reader',
  ssl: false,
  'tunnel-enabled': false,
  'advanced-options': false,
};

export type QuestionSpec = {
  /** The file in `questions/` (without `.sql`). */
  question: string;
  /** The card's name in Metabase: the business question, as spec §15.3 words it. */
  name: string;
  description: string;
  /** Default of every `:param` of the SQL, as a template tag; `all` lifts a filter. */
  defaults: Record<string, string>;
  /** In the first dashboard (the seven rows of §15.3), in this order. */
  onDashboard: boolean;
};

export const QUESTIONS: readonly QuestionSpec[] = [
  {
    question: 'decision-effort',
    name: '¿Cuánto cuesta una decisión aprobada, en tokens, en dinero declarado, en tiempo de persona y en ejecuciones?',
    description: 'Una fila por propuesta aceptada, con el esfuerzo acumulado de su hilo (v_decision_effort).',
    defaults: { project: 'all' },
    onDashboard: true,
  },
  {
    question: 'interaction-time',
    name: '¿Cuánto tarda DEMIURGO en responder y dónde se va el tiempo?',
    description: 'Una fila por interacción: total y por fase, con sus tokens (v_interaction_summary).',
    defaults: { project: 'all', since: 'all' },
    onDashboard: true,
  },
  {
    question: 'cache-by-provider',
    name: '¿Qué porcentaje del contexto se reutiliza de caché por proveedor y qué sesiones se pierden?',
    description:
      'Por proveedor y modelo: proporción de caché y sesiones reanudadas enteras, a medias o perdidas (v_session_reuse).',
    defaults: { since: 'all' },
    onDashboard: true,
  },
  {
    question: 'engine-acceptance',
    name: '¿Qué motor da más propuestas aceptadas sin edición por token gastado?',
    description: 'Por motor: propuestas aceptadas, editadas y rechazadas por cada 1 000 tokens de salida (v_engine_acceptance).',
    defaults: {},
    onDashboard: true,
  },
  {
    question: 'interventions',
    name: '¿Cuántas intervenciones pide cada decisión y cuántas preguntas quedan sin responder?',
    description:
      'Por hilo: intervenciones de personas frente al sistema, preguntas planteadas, respondidas y abiertas (v_interventions).',
    defaults: { project: 'all' },
    onDashboard: true,
  },
  {
    question: 'context-budget',
    name: '¿Cuánto presupuesto de contexto se llena y cuánto se descarta por sección?',
    description:
      'Por constructor y sección: llenado del presupuesto y fragmentos incluidos, recortados y descartados (v_context_budget).',
    defaults: { project: 'all' },
    onDashboard: true,
  },
  {
    question: 'engine-reliability',
    name: '¿Qué falla, cuánto y en qué motor?',
    description:
      'Por motor: llamadas fallidas por tipo, planes B, reintentos, sesiones perdidas y valoración de las personas (v_engine_reliability).',
    defaults: {},
    onDashboard: true,
  },
  {
    question: 'session-reuse',
    name: 'Sesión de una ejecución: ¿reanudó, desde qué base, con qué delta y cuánta caché?',
    description: 'Una fila por llamada de la ejecución y de las que reanuda; pon el id de la ejecución en «Run».',
    defaults: { run: NO_RUN },
    onDashboard: false,
  },
  {
    question: 'context-of-run',
    name: 'Contexto de una ejecución: ¿qué recibió el agente y de dónde salió cada pieza?',
    description: 'Una fila por fragmento del context pack, descartados incluidos; pon el id de la ejecución en «Run».',
    defaults: { run: NO_RUN },
    onDashboard: false,
  },
  {
    question: 'tokens-by-engine',
    name: '¿Cuántos tokens y cuántas llamadas gasta cada motor?',
    description: 'Por motor desde una fecha: llamadas, tokens por clase, proporción de caché y coste declarado (provider_calls).',
    defaults: { since: 'all' },
    onDashboard: false,
  },
];

// ---------------------------------------------------------------------------------------------
// Pure parts (tested in test/metabase.test.ts).

export type TemplateTag = {
  id: string;
  name: string;
  'display-name': string;
  type: 'text';
  default: string;
  required: true;
};

export type NativeQuery = { query: string; templateTags: Record<string, TemplateTag> };

// `:name` outside `::casts` and quoted strings is a parameter (the same rule as ask.ts).
const RE_PARAM = /(?<![:\w'])(:)([a-z][a-z0-9_]*)\b/g;

/** A stable uuid for a tag name, so re-running the setup rewrites the same tags. */
export function tagId(name: string): string {
  const h = createHash('sha1').update(`demiurgo-metabase-tag:${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const displayName = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1).replaceAll('_', ' ');

/**
 * The SQL of a saved question as a Metabase native query: every `:param` becomes `{{param}}` and a
 * required text template tag with the default given. Metabase substitutes a text tag as a quoted
 * string, which is what the questions expect (`:project = 'all'`, `nullif(:since, 'all')`). A `::cast`
 * and a `:` inside a string are left alone. Every parameter needs a default: the card must run as is.
 */
export function toNativeQuery(sql: string, defaults: Record<string, string>): NativeQuery {
  const templateTags: Record<string, TemplateTag> = {};
  const query = sql.replace(RE_PARAM, (_m, _colon: string, name: string) => {
    if (!templateTags[name]) {
      const value = defaults[name];
      if (value === undefined) throw new Error(`No default for parameter :${name}.`);
      templateTags[name] = {
        id: tagId(name),
        name,
        'display-name': displayName(name),
        type: 'text',
        default: value,
        required: true,
      };
    }
    return `{{${name}}}`;
  });
  const unused = Object.keys(defaults).filter((k) => !templateTags[k]);
  if (unused.length > 0) throw new Error(`Defaults for parameters the SQL does not use: ${unused.join(', ')}.`);
  return { query, templateTags };
}

export type Named = { id: number; name: string; archived?: boolean | null };

/** The item that already has this name (whitespace-insensitive), ignoring archived ones; the oldest when there are several. */
export function byName<T extends Named>(items: readonly T[], name: string): T | undefined {
  const key = name.replace(/\s+/g, ' ').trim();
  return items.filter((i) => !i.archived && i.name.replace(/\s+/g, ' ').trim() === key).sort((a, b) => a.id - b.id)[0];
}

export type CardPosition = { row: number; col: number; size_x: number; size_y: number };

/** Two cards per row, half the grid each and 6 rows tall; an odd last card takes the whole row. */
export function dashboardLayout(count: number, height = 6): CardPosition[] {
  const half = GRID_WIDTH / 2;
  return Array.from({ length: count }, (_, i) => {
    const last = i === count - 1 && count % 2 === 1;
    return { row: Math.floor(i / 2) * height, col: last ? 0 : (i % 2) * half, size_x: last ? GRID_WIDTH : half, size_y: height };
  });
}

export type Dashcard = CardPosition & {
  id: number;
  card_id: number;
  parameter_mappings: unknown[];
  visualization_settings: Record<string, unknown>;
};

/**
 * The dashcards to send: one per card in order, keeping the id of the dashcard that already shows that
 * card (Metabase keeps it and moves it) and a fresh negative id for a new one. Dashcards of other cards
 * are left out, which removes them.
 */
export function planDashcards(
  cardIds: readonly number[],
  existing: readonly { id: number; card_id: number | null }[],
): Dashcard[] {
  const positions = dashboardLayout(cardIds.length);
  let next = -1;
  return cardIds.map((cardId, i) => {
    const current = existing.find((d) => d.card_id === cardId);
    const id = current ? current.id : next--;
    return { id, card_id: cardId, parameter_mappings: [], visualization_settings: {}, ...(positions[i] as CardPosition) };
  });
}

/** The admin password, from the env file that `pnpm evidence:up` generates. */
export async function readAdminPassword(path = ENV_FILE): Promise<string> {
  const text = await readFile(path, 'utf8').catch(() => {
    throw new Error(`Cannot read ${path}: run pnpm evidence:up first (it generates METABASE_ADMIN_PASSWORD).`);
  });
  const password = parseEnvFile(text).METABASE_ADMIN_PASSWORD;
  if (!password) throw new Error(`METABASE_ADMIN_PASSWORD is missing from ${path}: run pnpm evidence:up to add it.`);
  return password;
}

// ---------------------------------------------------------------------------------------------
// The API client.

export class MetabaseError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;

  constructor(status: number, method: string, path: string, body: string) {
    super(`${method} ${path} → ${status}: ${body.slice(0, 600)}`);
    this.name = 'MetabaseError';
    this.status = status;
    this.method = method;
    this.path = path;
  }
}

export class MetabaseClient {
  readonly url: string;
  readonly fetchImpl: typeof fetch;
  #session: string | undefined;

  constructor(url: string, fetchImpl: typeof fetch = fetch) {
    this.url = url;
    this.fetchImpl = fetchImpl;
  }

  set session(id: string) {
    this.#session = id;
  }

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.#session) headers['x-metabase-session'] = this.#session;
    const response = await this.fetchImpl(`${this.url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new MetabaseError(response.status, method, path, text);
    if (text === '') return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }
}

type Properties = { 'setup-token'?: string | null; 'has-user-setup'?: boolean; version?: { tag?: string } };
type Database = Named & { engine?: string; is_sample?: boolean };
type Collection = Named & { location?: string; personal_owner_id?: number | null };
type Card = Named & { collection_id?: number | null };
type Dashboard = Named & { collection_id?: number | null; dashcards?: { id: number; card_id: number | null }[] };
type QueryResult = { status?: string; error?: string; row_count?: number; data?: { rows?: unknown[][] } };

/** `GET` lists of this version come as an array or as `{ data: [...] }`. */
const list = <T>(r: T[] | { data: T[] }): T[] => (Array.isArray(r) ? r : r.data);

export type SetupOptions = {
  url?: string;
  password?: string;
  questionsDir?: string;
  log?: (line: string) => void;
  fetchImpl?: typeof fetch;
};

export type SetupReport = {
  version: string;
  account: 'created' | 'signed-in';
  database: { id: number; action: 'created' | 'updated' };
  sampleDatabasesRemoved: number;
  collection: { id: number; action: 'created' | 'kept' };
  cards: { question: string; id: number; action: 'created' | 'updated'; status: string; rows: number | null; error?: string }[];
  dashboard: { id: number; action: 'created' | 'kept'; cards: number };
};

/** Makes Metabase ready, or brings it up to date. Idempotent. */
export async function setupMetabase(options: SetupOptions = {}): Promise<SetupReport> {
  const url = (options.url ?? process.env.METABASE_URL ?? DEFAULT_METABASE_URL).replace(/\/+$/, '');
  const password = options.password ?? (await readAdminPassword());
  const questionsDir = options.questionsDir ?? QUESTIONS_DIR;
  const log = options.log ?? (() => undefined);
  const api = new MetabaseClient(url, options.fetchImpl);

  // 1. The admin account: created on a fresh Metabase, signed in afterwards.
  const properties = await api.call<Properties>('GET', '/api/session/properties');
  const version = properties.version?.tag ?? 'unknown';
  let account: SetupReport['account'];
  if (properties['has-user-setup'] === false && properties['setup-token']) {
    const created = await api.call<{ id: string }>('POST', '/api/setup', {
      token: properties['setup-token'],
      user: { email: ADMIN_EMAIL, password, first_name: 'Evidence', last_name: 'DEMIURGO' },
      prefs: { site_name: 'DEMIURGO evidence', site_locale: 'en' },
    });
    api.session = created.id;
    account = 'created';
  } else {
    const session = await api
      .call<{ id: string }>('POST', '/api/session', { username: ADMIN_EMAIL, password })
      .catch((e: unknown) => {
        if (e instanceof MetabaseError && e.status === 401)
          throw new Error(
            `Metabase rejected ${ADMIN_EMAIL}: METABASE_ADMIN_PASSWORD in ${ENV_FILE} is not the account's password.`,
          );
        throw e;
      });
    api.session = session.id;
    account = 'signed-in';
  }
  log(`Metabase ${version}: ${account === 'created' ? `created ${ADMIN_EMAIL}` : `signed in as ${ADMIN_EMAIL}`}.`);

  // 2. The evidence connection, read-only through the role; the sample database gone.
  const databases = list(await api.call<Database[] | { data: Database[] }>('GET', '/api/database'));
  let sampleDatabasesRemoved = 0;
  for (const sample of databases.filter((d) => d.is_sample)) {
    await api.call('DELETE', `/api/database/${sample.id}`);
    sampleDatabasesRemoved += 1;
  }
  const connection = {
    name: DATABASE_NAME,
    engine: 'postgres',
    details: DATABASE_DETAILS,
    is_full_sync: true,
    auto_run_queries: true,
  };
  const existingDb = byName(databases, DATABASE_NAME);
  let database: SetupReport['database'];
  if (existingDb) {
    await api.call('PUT', `/api/database/${existingDb.id}`, connection);
    database = { id: existingDb.id, action: 'updated' };
  } else {
    const created = await api.call<{ id: number }>('POST', '/api/database', connection);
    database = { id: created.id, action: 'created' };
  }
  log(`Database "${DATABASE_NAME}" ${database.action} (id ${database.id}); sample databases removed: ${sampleDatabasesRemoved}.`);

  // 3. The collection, at the root.
  const collections = list(await api.call<Collection[] | { data: Collection[] }>('GET', '/api/collection'));
  const existingCollection = byName(
    collections.filter((c) => typeof c.id === 'number' && (c.location ?? '/') === '/' && !c.personal_owner_id),
    COLLECTION_NAME,
  );
  let collection: SetupReport['collection'];
  if (existingCollection) collection = { id: existingCollection.id, action: 'kept' };
  else {
    const created = await api.call<{ id: number }>('POST', '/api/collection', {
      name: COLLECTION_NAME,
      description: 'The questions and the first dashboard of the evidence base (spec §15.3).',
      parent_id: null,
    });
    collection = { id: created.id, action: 'created' };
  }
  log(`Collection "${COLLECTION_NAME}" ${collection.action} (id ${collection.id}).`);

  // 4. One native question per saved question.
  const cards = list(await api.call<Card[] | { data: Card[] }>('GET', '/api/card?f=all'));
  const report: SetupReport['cards'] = [];
  const dashboardCardIds: number[] = [];
  for (const spec of QUESTIONS) {
    const sql = await readFile(join(questionsDir, `${spec.question}.sql`), 'utf8');
    const native = toNativeQuery(sql, spec.defaults);
    const payload = {
      name: spec.name,
      description: spec.description,
      collection_id: collection.id,
      display: 'table',
      visualization_settings: {},
      dataset_query: {
        type: 'native',
        database: database.id,
        native: { query: native.query, 'template-tags': native.templateTags },
      },
    };
    const existingCard = byName(cards, spec.name);
    let id: number;
    let action: 'created' | 'updated';
    if (existingCard) {
      await api.call('PUT', `/api/card/${existingCard.id}`, payload);
      id = existingCard.id;
      action = 'updated';
    } else {
      const created = await api.call<{ id: number }>('POST', '/api/card', { ...payload, type: 'question' });
      id = created.id;
      action = 'created';
    }
    if (spec.onDashboard) dashboardCardIds.push(id);
    report.push({ question: spec.question, id, action, status: 'pending', rows: null });
  }
  log(
    `Cards: ${report.filter((c) => c.action === 'created').length} created, ${report.filter((c) => c.action === 'updated').length} updated.`,
  );

  // 5. The dashboard with the seven cards; `dashcards` replaces the whole set.
  const dashboards = list(await api.call<Dashboard[] | { data: Dashboard[] }>('GET', '/api/dashboard?f=all'));
  const existingDashboard = byName(dashboards, DASHBOARD_NAME);
  let dashboard: SetupReport['dashboard'];
  if (existingDashboard) dashboard = { id: existingDashboard.id, action: 'kept', cards: 0 };
  else {
    const created = await api.call<{ id: number }>('POST', '/api/dashboard', {
      name: DASHBOARD_NAME,
      description: 'Las siete preguntas de negocio del primer cuadro (spec §15.3), sobre la base de evidencia.',
      collection_id: collection.id,
    });
    dashboard = { id: created.id, action: 'created', cards: 0 };
  }
  const current = await api.call<Dashboard>('GET', `/api/dashboard/${dashboard.id}`);
  const dashcards = planDashcards(dashboardCardIds, current.dashcards ?? []);
  await api.call('PUT', `/api/dashboard/${dashboard.id}`, { dashcards });
  dashboard.cards = dashcards.length;
  log(`Dashboard "${DASHBOARD_NAME}" ${dashboard.action} (id ${dashboard.id}) with ${dashcards.length} cards.`);

  // 6. Every card runs once, with its defaults.
  for (const card of report) {
    try {
      const result = await api.call<QueryResult>('POST', `/api/card/${card.id}/query`, { ignore_cache: true });
      card.status = result.status ?? 'unknown';
      card.rows = result.row_count ?? result.data?.rows?.length ?? null;
      if (result.error) card.error = result.error;
    } catch (e) {
      card.status = 'failed';
      card.error = e instanceof Error ? e.message : String(e);
    }
    log(
      `  ${card.question}: ${card.status}${card.rows === null ? '' : `, ${card.rows} row(s)`}${card.error ? ` — ${card.error}` : ''}`,
    );
  }
  return { version, account, database, sampleDatabasesRemoved, collection, cards: report, dashboard };
}
