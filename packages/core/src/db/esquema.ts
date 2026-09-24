// Tipos de Kysely de las tablas. Escritos a mano junto a las migraciones SQL; la prueba de
// esquema comprueba que las columnas coinciden con la base migrada.

import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';

type Marca = ColumnType<Date, Date | string | undefined, Date | string>;
type MarcaNula = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
type Json = ColumnType<unknown, string, string>;
type JsonNulo = ColumnType<unknown, string | null | undefined, string | null>;
type Entero64 = ColumnType<string, number | string | bigint, number | string | bigint>;
type IdentidadGenerada = ColumnType<string, never, never>;
type Contador = ColumnType<string, number | string | undefined, number | string>;

export type TablaProyectos = {
  id: Generated<string>;
  name: string;
  state: string;
  event_seq: Contador;
  created_at: Generated<Marca>;
};

export type TablaEventos = {
  id: IdentidadGenerada;
  project_id: string;
  seq: Entero64;
  at: Generated<Marca>;
  actor: string;
  command: string;
  entity_type: string;
  entity_id: string;
  entity_version: number | null;
  state_before: string | null;
  state_after: string | null;
  before: JsonNulo;
  after: JsonNulo;
  cause: JsonNulo;
};

export type TablaPersonas = {
  id: Generated<string>;
  username: string;
  password_hash: string;
  created_at: Generated<Marca>;
};

export type TablaSesiones = {
  id: Generated<string>;
  human_id: string;
  token_hash: string;
  csrf_hash: string;
  created_at: Generated<Marca>;
  expires_at: Marca;
  revoked_at: MarcaNula;
};

export type TablaContextPacks = {
  id: Generated<string>;
  project_id: string;
  role: string;
  builder: string;
  budget: Json;
  graph_version: Entero64;
  dependencies: Json;
  content: Json;
  hash: string;
  state: string;
  created_at: Generated<Marca>;
};

export type TablaRuns = {
  id: Generated<string>;
  project_id: string;
  action: string;
  scope: Json;
  method: string;
  schema_version: string;
  provider: string;
  model: string | null;
  context_pack_id: string | null;
  retry_of: string | null;
  state: string;
  failure_kind: string | null;
  error: string | null;
  output: JsonNulo;
  usage: JsonNulo;
  requested_by: string;
  created_at: Generated<Marca>;
  started_at: MarcaNula;
  finished_at: MarcaNula;
};

export type TablaRegistrosRun = {
  id: Generated<string>;
  project_id: string;
  run_id: string;
  attempt: number;
  raw_gzip: Buffer;
  created_at: Generated<Marca>;
};

export type TablaPasosCompletados = {
  workflow_id: string;
  step: string;
  result: JsonNulo;
  completed_at: Generated<Marca>;
};

export type TablaTokensAgente = {
  id: Generated<string>;
  project_id: string;
  name: string;
  token_hash: string;
  state: string;
  issued_by: string;
  created_at: Generated<Marca>;
  revoked_at: MarcaNula;
};

export type TablaExploraciones = {
  id: Generated<string>;
  project_id: string;
  parent_id: string | null;
  purpose: string;
  origin_type: string | null;
  origin_id: string | null;
  origin_version: number | null;
  state: string;
  state_reason: string | null;
  opened_by: string;
  created_at: Generated<Marca>;
};

export type TablaPreguntas = {
  id: Generated<string>;
  project_id: string;
  exploration_id: string;
  question: string;
  reason: string | null;
  impact: string | null;
  conclusion: string | null;
  reasoning: string | null;
  state: string;
  state_reason: string | null;
  raised_by: string;
  created_at: Generated<Marca>;
};

export type TablaMensajes = {
  id: Generated<string>;
  project_id: string;
  exploration_id: string;
  question_id: string | null;
  author: string;
  run_id: string | null;
  kind: string | null;
  body: string;
  state: string;
  created_at: Generated<Marca>;
};

export type TablaFuentes = {
  id: Generated<string>;
  project_id: string;
  name: string;
  content: string;
  content_hash: string;
  registered_by: string;
  state: string;
  created_at: Generated<Marca>;
};

export type TablaRegistros = {
  id: Generated<string>;
  project_id: string;
  code: string;
  type: string;
  domain: string;
  state: string;
  created_at: Generated<Marca>;
};

export type TablaVersiones = {
  id: Generated<string>;
  project_id: string;
  record_id: string;
  n: number;
  title: string;
  sections: Json;
  annexes: Json;
  increment: string | null;
  change_note: string | null;
  origin: JsonNulo;
  author: string;
  content_hash: string;
  state: string;
  created_at: Generated<Marca>;
  approved_at: MarcaNula;
  approved_by: string | null;
};

export type TablaCriterios = {
  id: Generated<string>;
  project_id: string;
  record_version_id: string;
  code: string;
  title: string;
  statement: string;
  verification: string;
  check_text: string;
  derived_from: string | null;
  carry: string;
  position: number;
  state: string;
  created_at: Generated<Marca>;
};

export type TablaEnlaces = {
  id: Generated<string>;
  project_id: string;
  type: string;
  from_type: string;
  from_id: string;
  from_version: number | null;
  to_type: string;
  to_id: string;
  to_version: number | null;
  state: string;
  created_by: string;
  created_at: Generated<Marca>;
};

export type TablaLotes = {
  id: Generated<string>;
  project_id: string;
  kind: string;
  producer: string;
  run_id: string | null;
  context_pack_id: string | null;
  resolution_mode: string;
  dependencies: Json;
  summary: string | null;
  tree_hash: string | null;
  state: string;
  created_at: Generated<Marca>;
  resolved_at: MarcaNula;
  resolved_by: string | null;
};

export type TablaPropuestas = {
  id: Generated<string>;
  project_id: string;
  batch_id: string;
  position: number;
  type: string;
  payload: Json;
  dependencies: Json;
  state: string;
  resolution: JsonNulo;
  resolved_by: string | null;
  resolved_at: MarcaNula;
  created_at: Generated<Marca>;
};

export type TablaTaxonomias = {
  id: Generated<string>;
  project_id: string;
  code: string;
  version: number;
  title: string;
  axes: Json;
  sections: Json;
  content_hash: string;
  state: string;
  author: string;
  created_at: Generated<Marca>;
  approved_at: MarcaNula;
  approved_by: string | null;
};

export type TablaEstadoGrafo = {
  project_id: string;
  version: Contador;
  last_update_id: string | null;
};

export type TablaNodos = {
  id: Generated<string>;
  project_id: string;
  ref: string;
  kind: string;
  source_type: string;
  source_id: string | null;
  source_version: number | null;
  label: string;
  body: string;
  categories: Json;
  epistemic: string;
  valid_from: Entero64;
  valid_to: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  created_by_update: string | null;
  state: string;
  created_at: Generated<Marca>;
};

export type TablaAristas = {
  id: Generated<string>;
  project_id: string;
  kind: string;
  from_node: string;
  to_node: string;
  valid_from: Entero64;
  valid_to: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  created_by_update: string | null;
  state: string;
  created_at: Generated<Marca>;
};

export type TablaActualizaciones = {
  id: Generated<string>;
  project_id: string;
  trigger: Json;
  trigger_seq: Entero64;
  change: JsonNulo;
  candidates: JsonNulo;
  candidates_hash: string | null;
  input_hash: string | null;
  classifier: string | null;
  verdicts: JsonNulo;
  verification: JsonNulo;
  operations: JsonNulo;
  graph_version_before: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  graph_version_after: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  failure: string | null;
  state: string;
  created_at: Generated<Marca>;
  finished_at: MarcaNula;
};

export type TablaCacheVeredictos = {
  input_hash: string;
  classifier: string;
  answers: Json;
  created_at: Generated<Marca>;
};

export type TablaClasificaciones = {
  id: Generated<string>;
  project_id: string;
  node_ref: string;
  taxonomy_id: string;
  axis: string;
  category: string;
  confidence: number;
  justification: string;
  classifier: string;
  input_hash: string;
  update_id: string | null;
  resolution: JsonNulo;
  resolved_by: string | null;
  state: string;
  created_at: Generated<Marca>;
};

export type TablaEvaluacionesIdea = {
  id: Generated<string>;
  project_id: string;
  proposal_id: string;
  findings: Json;
  graph_version: Entero64;
  classifier: string;
  input_hash: string;
  state: string;
  created_at: Generated<Marca>;
};

export type TablaEvaluacionesClasificador = {
  id: Generated<string>;
  classifier: string;
  dataset: string;
  partition: string;
  task: string;
  metrics: Json;
  file: string | null;
  created_at: Generated<Marca>;
};

export type BD = {
  projects: TablaProyectos;
  events: TablaEventos;
  humans: TablaPersonas;
  sessions: TablaSesiones;
  context_packs: TablaContextPacks;
  ai_runs: TablaRuns;
  ai_run_logs: TablaRegistrosRun;
  step_completions: TablaPasosCompletados;
  agent_tokens: TablaTokensAgente;
  explorations: TablaExploraciones;
  questions: TablaPreguntas;
  messages: TablaMensajes;
  sources: TablaFuentes;
  records: TablaRegistros;
  record_versions: TablaVersiones;
  criteria: TablaCriterios;
  links: TablaEnlaces;
  proposal_batches: TablaLotes;
  proposals: TablaPropuestas;
  taxonomies: TablaTaxonomias;
  knowledge_graph_state: TablaEstadoGrafo;
  knowledge_nodes: TablaNodos;
  knowledge_edges: TablaAristas;
  knowledge_updates: TablaActualizaciones;
  verdict_cache: TablaCacheVeredictos;
  classifications: TablaClasificaciones;
  idea_assessments: TablaEvaluacionesIdea;
  classifier_evaluations: TablaEvaluacionesClasificador;
};

export type Fila<T extends keyof BD> = Selectable<BD[T]>;
export type NuevaFila<T extends keyof BD> = Insertable<BD[T]>;
