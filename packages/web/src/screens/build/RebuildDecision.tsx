// «Built on v2, now v3»: a merged task with a newer approved version waits for a person (convención nuestra, inspired
// by Kanban's explicit re-entry policies and the Scrum Product Owner ordering the backlog). «Rebuild» starts the
// build as «Start build» does; «Satisfied by main» records that the merged build already covers the new version.

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { buildQueueQuery } from '../../api/queries.ts';
import { Button } from '../../components/Button.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { Field, TextArea } from '../../components/Field.tsx';
import { announce } from '../../components/announce.tsx';
import { useMessages } from '../../i18n/define.ts';
import { BUILD } from './words.i18n.ts';

export function RebuildDecisionButtons({
  projectId,
  code,
  builtOn,
  now,
  github,
}: {
  projectId: string;
  code: string;
  builtOn: number;
  now: number;
  github: boolean;
}) {
  const t = useMessages(BUILD);
  const client = useQueryClient();
  const [rebuilding, setRebuilding] = useState(false);
  const [satisfying, setSatisfying] = useState(false);
  const [note, setNote] = useState('');
  const request = useCommand(projectId);
  const agent = useCommand(projectId);
  const satisfied = useCommand(projectId);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: buildQueueQuery(projectId).queryKey });
    void client.invalidateQueries({ queryKey: ['p', projectId] });
  };
  const rebuild = () => {
    if (request.isPending || agent.isPending) return;
    request.mutate(
      { command: 'build_request.request', data: { task: code } },
      {
        onSuccess: () => {
          refresh();
          if (!github) return setRebuilding(false);
          agent.mutate(
            { command: 'build.start', data: { task: code } },
            { onSuccess: refresh, onSettled: () => setRebuilding(false) },
          );
        },
      },
    );
  };
  return (
    <div className="flex flex-wrap items-center justify-end gap-2" data-rebuild-decision={code}>
      <Button
        size="sm"
        variant="secondary"
        aria-label={t.satisfiedLabel(code)}
        data-satisfied={code}
        onClick={() => {
          satisfied.reset();
          setSatisfying(true);
        }}
      >
        {t.satisfied}
      </Button>
      <Button
        size="sm"
        variant="primary"
        aria-label={t.rebuildLabel(code)}
        data-rebuild={code}
        onClick={() => {
          request.reset();
          agent.reset();
          setRebuilding(true);
        }}
      >
        {t.rebuild}
      </Button>
      <ConfirmDialog
        open={rebuilding}
        onOpenChange={(o) => {
          if (!request.isPending && !agent.isPending) setRebuilding(o);
        }}
        title={t.rebuildTitle(code)}
        description={<p>{t.rebuildBody(builtOn, now)}</p>}
        confirm={t.rebuild}
        onConfirm={rebuild}
        pending={request.isPending || agent.isPending}
        error={rebuilding ? (request.error ?? agent.error) : null}
      />
      <ConfirmDialog
        open={satisfying}
        onOpenChange={(o) => {
          if (!satisfied.isPending) setSatisfying(o);
        }}
        title={t.satisfiedTitle(code)}
        description={<p>{t.satisfiedBody(builtOn, now)}</p>}
        confirm={t.satisfied}
        onConfirm={() =>
          satisfied.mutate(
            { command: 'task.mark_satisfied', entityId: projectId, data: { task: code, ...(note.trim() ? { note: note.trim() } : {}) } },
            {
              onSuccess: () => {
                setSatisfying(false);
                setNote('');
                refresh();
                announce(t.satisfiedDone(code));
              },
            },
          )
        }
        pending={satisfied.isPending}
        error={satisfying ? satisfied.error : null}
      >
        <Field label={t.satisfiedNote} hint={t.satisfiedNoteHint} count={[note.length, 1000]}>
          {(props) => <TextArea {...props} value={note} maxLength={1000} autoGrow data-satisfied-note onChange={(ev) => setNote(ev.target.value)} />}
        </Field>
      </ConfirmDialog>
    </div>
  );
}
