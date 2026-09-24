// Tipos del bus de comandos: comando → capacidad → tabla → evento.

import type { Actor, CommandName, EntityName } from '@demiurgo/domain';
import type { z } from 'zod';
import type { Db, Tx } from '../db/connection.ts';
import type { Services } from '../services.ts';

/** Causa de un evento: agrupa los eventos de una misma petición y enlaza con su origen. */
export type Cause = {
  correlation: string;
  sourceCommand?: string;
  run?: string;
  proposal?: string;
  batch?: string;
  event?: string;
  /** Versión que se está creando: sus criterios y enlaces solo nacen dentro de su creación. */
  versionBeingCreated?: string;
};

export type Request = {
  command: CommandName;
  actor: Actor;
  /** Obligatorio salvo en `project.create`. */
  projectId?: string;
  /** Obligatorio salvo en los comandos que crean la entidad. */
  entityId?: string;
  data?: unknown;
  cause?: Partial<Cause>;
};

export type Result = {
  projectId: string;
  entity: EntityName;
  entityId: string;
  state: string;
  seq: number | null;
  result?: unknown;
};

export type LoadedEntity = {
  id: string;
  projectId: string;
  state: string;
  row: Record<string, unknown>;
};

export type CommandContext = {
  trx: Tx;
  actor: Actor;
  projectId: string;
  command: CommandName;
  cause: Cause;
  services: Services;
  /** Ejecuta otro comando dentro de la misma transacción (con su propio actor y evento). */
  execute(p: Request): Promise<Result>;
  /** Registra trabajo para después de confirmar (arrancar flujos, avisar). */
  afterConfirm(f: () => Promise<void> | void): void;
};

export type Applied = {
  entityId: string;
  /** Solo en project.create: el proyecto recién creado. */
  projectId?: string;
  version?: number | null;
  before?: unknown;
  after?: unknown;
  result?: unknown;
  /** Creación idempotente que ya existía: sin evento ni cambio. */
  noChanges?: boolean;
};

export type Handler<D = unknown> = {
  data: z.ZodType<D>;
  apply(ctx: CommandContext, data: D, entity: LoadedEntity | null, to: string): Promise<Applied>;
};

export type GuardContext = {
  ctx: CommandContext;
  data: unknown;
  entity: LoadedEntity | null;
};

/** Devuelve null si la guarda se cumple o el motivo en lenguaje de producto si no. */
export type Guard = (g: GuardContext) => Promise<string | null> | string | null;

export type { Db, Tx };
