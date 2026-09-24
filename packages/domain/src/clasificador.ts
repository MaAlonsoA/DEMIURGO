// Puerto `Classifier` (System One, §7.5 del plan). Tres primitivas tipadas y calibradas:
// Choice (opción de un conjunto cerrado), Score (nivel de una rúbrica ordenada) y Noul
// (probabilidad de que un enunciado sea verdadero). Nunca redacta texto ni decide avances.

export type EstadoClasificador = string | Readonly<Record<string, unknown>>;

export type ItemChoice = {
  id: string;
  /** Estado pequeño y relevante: solo el par que se evalúa. */
  estado: EstadoClasificador;
  pregunta: string;
  opciones: readonly string[];
};

export type RespuestaChoice = {
  id: string;
  eleccion: string;
  distribucion: Readonly<Record<string, number>>;
  confianza: number;
  justificacion: string;
};

export type ItemScore = { id: string; estado: EstadoClasificador; pregunta: string; niveles: readonly string[] };
export type RespuestaScore = { id: string; nivel: number; distribucion: readonly number[]; confianza: number };

export type ItemNoul = { id: string; estado: EstadoClasificador; enunciado: string };
export type RespuestaNoul = { id: string; probabilidad: number; confianza: number };

export interface Clasificador {
  /** nombre@versión: se guarda con cada clasificación y forma parte del `input_hash`. */
  readonly id: string;
  choice(items: readonly ItemChoice[]): Promise<RespuestaChoice[]>;
  score(items: readonly ItemScore[]): Promise<RespuestaScore[]>;
  noul(items: readonly ItemNoul[]): Promise<RespuestaNoul[]>;
}

export type Umbrales = { alta: number; media: number };

export const UMBRALES_POR_DEFECTO: Umbrales = { alta: 0.8, media: 0.55 };

export type Ruta = 'aplicar' | 'revisar_llm' | 'pendiente_persona';

/** Cascada por confianza: alta → se aplica; media → la revisa un LLM; baja → la persona. */
export function enrutarPorConfianza(confianza: number, umbrales: Umbrales = UMBRALES_POR_DEFECTO): Ruta {
  if (confianza >= umbrales.alta) return 'aplicar';
  if (confianza >= umbrales.media) return 'revisar_llm';
  return 'pendiente_persona';
}

// Vocabularios cerrados de los usos de §7.5.
export const VEREDICTOS = ['keep', 'update', 'invalidate', 'add', 'relate', 'other'] as const;
export type Veredicto = (typeof VEREDICTOS)[number];

export const HALLAZGOS_IDEA = ['relates', 'conflicts', 'inconsistent', 'duplicates', 'none'] as const;
export type HallazgoIdea = (typeof HALLAZGOS_IDEA)[number];

export const NIVELES_RELEVANCIA = ['irrelevante', 'poco relevante', 'relevante', 'muy relevante'] as const;
