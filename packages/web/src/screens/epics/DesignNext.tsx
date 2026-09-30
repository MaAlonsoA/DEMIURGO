// "Design the next one" (spec «Entrega por épicas», 1c): the next feature of an epic is designed in
// its own thread, hanging from the epic's thread (opened first when the epic has none) and born from
// the epic's current version. The first message asks DEMIURGO to design it, as the first-feature card.

import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { runCommand } from '../../api/commands.ts';
import { keys, stateQuery } from '../../api/queries.ts';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { messages, useMessages } from '../../i18n/define.ts';
import { type EpicLine, epicThread, featurePurpose } from './logic.ts';

const WORDS = messages(
  {
    design: 'Design the next one',
    designNamed: (name: string) => `Design "${name}"`,
    started: (name: string) => `Designing "${name}": DEMIURGO is answering in its thread.`,
  },
  {
    design: 'Diseñar la siguiente',
    designNamed: (name: string) => `Diseñar «${name}»`,
    started: (name: string) => `Diseñando «${name}»: DEMIURGO responde en su hilo.`,
  },
);

export type EpicRef = { code: string; title: string; currentId: string; versionIds: readonly (string | null)[] };

export function useDesignNext(projectId: string) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const t = useMessages(WORDS);
  const start = async (epic: EpicRef, line: EpicLine) => {
    setPending(true);
    setError(null);
    try {
      // Fresh: an epic thread opened a moment ago must be found, not opened twice.
      const state = await client.fetchQuery({ ...stateQuery(projectId), staleTime: 0 });
      const origin = { type: 'record_version' as const, id: epic.currentId };
      let parent = epicThread(state.explorations, epic.versionIds)?.id;
      if (!parent) {
        parent = (await runCommand(projectId, { command: 'exploration.open', data: { purpose: `About ${epic.title}`, origin } }))
          .entity_id;
      }
      const thread = (
        await runCommand(projectId, {
          command: 'exploration.open',
          data: { purpose: featurePurpose(line, epic.code), parent_id: parent, origin },
        })
      ).entity_id;
      const text = `Let's design "${line.name}"${line.phrase ? `: ${line.phrase}` : ''}`;
      await runCommand(projectId, { command: 'message.post', data: { exploration_id: thread, text, respond: true } });
      announce(t.started(line.name));
      void client.invalidateQueries({ queryKey: keys.project(projectId) });
      void navigate({ to: '/p/$projectId/threads/$explorationId', params: { projectId, explorationId: thread } });
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };
  return { start, pending, error };
}

/** The button that designs the next feature of an epic. */
export function DesignNextButton({
  projectId,
  epic,
  line,
  named = false,
  size,
  label,
}: {
  projectId: string;
  epic: EpicRef;
  line: EpicLine;
  named?: boolean;
  size?: 'sm';
  /** Overrides the words of the button. */
  label?: string;
}) {
  const t = useMessages(WORDS);
  const design = useDesignNext(projectId);
  return (
    <span className="inline-flex flex-col gap-2" data-design-next={line.name}>
      <Button
        variant="primary"
        size={size}
        pending={design.pending}
        onClick={() => void design.start(epic, line)}
      >
        {label ?? (named ? t.designNamed(line.name) : t.design)}
      </Button>
      {design.error ? <ErrorNotice error={design.error} compact /> : null}
    </span>
  );
}
