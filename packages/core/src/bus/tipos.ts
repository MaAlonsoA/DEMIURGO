// Tipos del bus de comandos: comando → capacidad → tabla → evento.

import type { Actor, NombreComando, NombreEntidad } from '@demiurgo/domain';
import type { z } from 'zod';
import type { Bd, Tx } from '../db/conexion.ts';
import type { Servicios } from '../servicios.ts';

/** Causa de un evento: agrupa los eventos de una misma petición y enlaza con su origen. */
export type Causa = {
  correlacion: string;
  comandoOrigen?: string;
  run?: string;
  propuesta?: string;
  lote?: string;
  evento?: string;
};

export type Peticion = {
  comando: NombreComando;
  actor: Actor;
  /** Obligatorio salvo en `project.create`. */
  proyectoId?: string;
  /** Obligatorio salvo en los comandos que crean la entidad. */
  entidadId?: string;
  datos?: unknown;
  causa?: Partial<Causa>;
};

export type Resultado = {
  proyectoId: string;
  entidad: NombreEntidad;
  entidadId: string;
  estado: string;
  seq: number | null;
  resultado?: unknown;
};

export type EntidadCargada = {
  id: string;
  proyectoId: string;
  estado: string;
  fila: Record<string, unknown>;
};

export type ContextoComando = {
  trx: Tx;
  actor: Actor;
  proyectoId: string;
  comando: NombreComando;
  causa: Causa;
  servicios: Servicios;
  /** Ejecuta otro comando dentro de la misma transacción (con su propio actor y evento). */
  ejecutar(p: Peticion): Promise<Resultado>;
  /** Registra trabajo para después de confirmar (arrancar flujos, avisar). */
  despuesDeConfirmar(f: () => Promise<void> | void): void;
};

export type Aplicado = {
  entidadId: string;
  /** Solo en project.create: el proyecto recién creado. */
  proyectoId?: string;
  version?: number | null;
  antes?: unknown;
  despues?: unknown;
  resultado?: unknown;
  /** Creación idempotente que ya existía: sin evento ni cambio. */
  sinCambios?: boolean;
};

export type Manejador<D = unknown> = {
  datos: z.ZodType<D>;
  aplicar(ctx: ContextoComando, datos: D, entidad: EntidadCargada | null, hacia: string): Promise<Aplicado>;
};

export type ContextoGuarda = {
  ctx: ContextoComando;
  datos: unknown;
  entidad: EntidadCargada | null;
};

/** Devuelve null si la guarda se cumple o el motivo en lenguaje de producto si no. */
export type Guarda = (g: ContextoGuarda) => Promise<string | null> | string | null;

export type { Bd, Tx };
