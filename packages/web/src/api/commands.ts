// The only way the UI writes: POST /api/projects/:projectId/commands/:command. After a 2xx the
// project's queries are invalidated; the event stream confirms afterwards (spec §2).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from './client.ts';
import { keys } from './queries.ts';
import type { CommandResponse } from './types.ts';

export type CommandCall = { command: string; entityId?: string | undefined; data?: Record<string, unknown> };

export function runCommand<R = unknown>(projectId: string, call: CommandCall): Promise<CommandResponse<R>> {
  return request<CommandResponse<R>>('POST', `/api/projects/${projectId}/commands/${call.command}`, {
    ...(call.entityId ? { entity_id: call.entityId } : {}),
    data: call.data ?? {},
  });
}

/** A command as a mutation: its error (ApiError) carries the reasons to show next to the action. */
export function useCommand<R = unknown>(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (call: CommandCall) => runCommand<R>(projectId, call),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.project(projectId) }),
  });
}
