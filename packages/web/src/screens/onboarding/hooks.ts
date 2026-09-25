// The data of a Day 1: its thread, the thread's runs, the project and where DEMIURGO's answer to
// the person's last message stands; and sending a message that DEMIURGO answers.

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { explorationQuery, projectsQuery, runsQuery, stagesQuery } from '../../api/queries.ts';
import { useNow } from '../run/hooks.ts';
import { isActive } from '../thread/timeline.ts';
import { personMessages, readingOf } from './day.ts';

export function useDay(projectId: string, explorationId: string) {
  const [waiting, setWaiting] = useState(false);
  // While DEMIURGO waits for knowledge, the message's own state is what moves: ask for it now and then.
  const thread = useQuery({ ...explorationQuery(projectId, explorationId), refetchInterval: waiting ? 2500 : false });
  // The stream brings the run; while DEMIURGO has not requested it yet, the list is also asked again
  // now and then, in case its first event arrived before the stream was open.
  const runs = useQuery({ ...runsQuery(projectId, { exploration: explorationId }), refetchInterval: waiting ? 2500 : false });
  const project = useQuery(projectsQuery).data?.find((p) => p.id === projectId);
  // The open design stage's mandatory questions live in the stage's own thread; the Day 1 walks
  // them too, so the person answers them here instead of finding an empty list.
  const stage = useQuery(stagesQuery(projectId)).data?.find((s) => s.state === 'open');
  const stageThreadId = stage?.exploration_id && stage.exploration_id !== explorationId ? stage.exploration_id : '';
  const stageThread = useQuery({ ...explorationQuery(projectId, stageThreadId), enabled: !!stageThreadId });
  const mandatory = (stageThread.data?.questions ?? []).filter((q) => q.stage_id);
  const merged = thread.data && mandatory.length ? { ...thread.data, questions: [...thread.data.questions, ...mandatory] } : thread.data;
  const people = thread.data ? personMessages(thread.data.messages) : [];
  const idea = people[0];
  const latest = people.at(-1);
  const now = useNow(waiting || (runs.data ?? []).some(isActive));
  const reading = readingOf(runs.data ?? [], latest);
  useEffect(() => setWaiting(reading.phase === 'waiting' || reading.phase === 'catching_up'), [reading.phase]);
  return {
    thread: merged,
    runs: runs.data,
    project,
    idea,
    latest,
    reading,
    now,
    error: thread.error ?? runs.error,
  };
}

/** Writes in the thread and asks DEMIURGO to answer (the durable response requests the run). */
export function useSend(projectId: string, explorationId: string) {
  const command = useCommand(projectId);
  const send = (text: string, onSent?: () => void) =>
    command.mutate(
      { command: 'message.post', data: { exploration_id: explorationId, text, respond: true, agent: 'onboarding' } },
      { onSuccess: () => onSent?.() },
    );
  return { send, pending: command.isPending, error: command.error, reset: command.reset };
}
