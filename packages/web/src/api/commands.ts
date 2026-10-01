// The only way the UI writes: POST /api/projects/:projectId/commands/:command. After a 2xx the
// project's queries are invalidated; the event stream confirms afterwards (spec §2).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, request } from './client.ts';
import { keys } from './queries.ts';
import type { CommandResponse } from './types.ts';

export type CommandCall = { command: string; entityId?: string | undefined; data?: Record<string, unknown> };

/**
 * Start of the sentence the server's `graph_up_to_date` guard answers with (409) while knowledge
 * updates are pending (packages/core/src/commands/runs.ts). Keep the match here, in one place.
 */
export const KNOWLEDGE_NOT_READY = "The project's knowledge is not up to date";
/** Commands that request a run, and so hit that guard. */
const RUN_COMMANDS = new Set(['run.request', 'run.retry']);
export const KNOWLEDGE_RETRY_EVERY_MS = 3000;
export const KNOWLEDGE_RETRY_FOR_MS = 3 * 60 * 1000;

export function isKnowledgeNotReady(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    [error.message, ...error.reasons].some((r) => r.startsWith(KNOWLEDGE_NOT_READY))
  );
}

/**
 * Runs `attempt`; while it fails because knowledge is not up to date, waits and tries again
 * (every 3 s for up to 3 minutes). Any other error, or the last one after the time is up, is thrown.
 */
export async function retryWhileKnowledgeBusy<T>(
  attempt: () => Promise<T>,
  opts: {
    onWaiting?: (waiting: boolean) => void;
    everyMs?: number;
    forMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  const every = opts.everyMs ?? KNOWLEDGE_RETRY_EVERY_MS;
  const limit = opts.forMs ?? KNOWLEDGE_RETRY_FOR_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let waited = 0;
  try {
    for (;;) {
      try {
        return await attempt();
      } catch (error) {
        if (!isKnowledgeNotReady(error) || waited + every > limit) throw error;
        opts.onWaiting?.(true);
        await sleep(every);
        waited += every;
      }
    }
  } finally {
    opts.onWaiting?.(false);
  }
}

/** The server queued the request (HTTP 202, `result.deferred`): it starts by itself once knowledge is up to date. */
export function isDeferred(response: CommandResponse<unknown>): boolean {
  const r = response.result;
  return typeof r === 'object' && r !== null && (r as { deferred?: unknown }).deferred === true;
}

export function runCommand<R = unknown>(
  projectId: string,
  call: CommandCall,
  onWaiting?: (waiting: boolean) => void,
): Promise<CommandResponse<R>> {
  const post = () => post1<R>(projectId, call);
  return RUN_COMMANDS.has(call.command) ? retryWhileKnowledgeBusy(post, { ...(onWaiting ? { onWaiting } : {}) }) : post();
}

function post1<R>(projectId: string, call: CommandCall): Promise<CommandResponse<R>> {
  return request<CommandResponse<R>>('POST', `/api/projects/${projectId}/commands/${call.command}`, {
    ...(call.entityId ? { entity_id: call.entityId } : {}),
    data: call.data ?? {},
  });
}

/** A command as a mutation: its error (ApiError) carries the reasons to show next to the action. */
export function useCommand<R = unknown>(projectId: string) {
  const client = useQueryClient();
  const [waiting, setWaiting] = useState(false);
  const [queued, setQueued] = useState(false);
  const mutation = useMutation({
    mutationFn: async (call: CommandCall) => {
      setQueued(false);
      const response = await runCommand<R>(projectId, call, setWaiting);
      // Queued on the server: no retrying here, the person can leave the page.
      if (isDeferred(response)) setQueued(true);
      return response;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: keys.project(projectId) }),
  });
  // `waiting`: a run request is retrying until the project's knowledge is up to date (fallback).
  // `queued`: the server queued it and starts it by itself.
  return Object.assign(mutation, { waiting, queued });
}
