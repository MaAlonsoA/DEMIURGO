// Command bus types: command → capability → table → event.

import type { Actor, CommandName, EntityName } from '@demiurgo/domain';
import type { z } from 'zod';
import type { Db, Tx } from '../db/connection.ts';
import type { Services } from '../services.ts';

/** Event cause: groups the events from a single request and links to its origin. */
export type Cause = {
  correlation: string;
  sourceCommand?: string;
  run?: string;
  proposal?: string;
  batch?: string;
  event?: string;
  /** Version being created: its criteria and links are only born within its creation. */
  versionBeingCreated?: string;
};

export type Request = {
  command: CommandName;
  actor: Actor;
  /** Required except in `project.create`. */
  projectId?: string;
  /** Required except in commands that create the entity. */
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
  /** The command was not applied: it waits (a guard deferred it) and starts by itself later. */
  deferred?: true;
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
  /** Executes another command within the same transaction (with its own actor and event). */
  execute(p: Request): Promise<Result>;
  /** Registers work for after commit (starting workflows, notifying). */
  afterCommit(f: () => Promise<void> | void): void;
};

export type Applied = {
  entityId: string;
  /** Only in project.create: the newly created project. */
  projectId?: string;
  version?: number | null;
  before?: unknown;
  after?: unknown;
  result?: unknown;
  /** Idempotent creation that already existed: no event, no change. */
  noChanges?: boolean;
};

export type Handler<D = unknown> = {
  data: z.ZodType<D>;
  apply(ctx: CommandContext, data: D, entity: LoadedEntity | null, to: string): Promise<Applied>;
  /**
   * Only for commands whose guards may defer: records the request to run later (no state change, no
   * event) and returns the key it waits under. The bus answers `deferred: true`.
   */
  defer?(ctx: CommandContext, data: D): Promise<{ key: string }>;
};

export type GuardContext = {
  ctx: CommandContext;
  data: unknown;
  entity: LoadedEntity | null;
};

/** Returns null when the guard holds, or the reason in product language otherwise. */
export type Guard = (g: GuardContext) => Promise<GuardOutcome> | GuardOutcome;

/**
 * A guard that does not hold but whose command may wait: `{ defer }` says why. The bus only defers
 * when every failing guard defers and the command's handler declares a `defer` (otherwise the
 * reason is an ordinary 409).
 */
export type GuardDefer = { defer: string };
export type GuardOutcome = string | null | GuardDefer;

export type { Db, Tx };
