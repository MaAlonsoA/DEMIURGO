// Changing an epic's list by hand: add a feature (it reserves its code), move or drop one not designed
// yet. The epic's thread proposes the same changes.

import { type FormEvent, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { Field, TextInput } from '../../components/Field.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { useMessages } from '../../i18n/define.ts';
import type { EpicLine } from './logic.ts';
import { PLAN_EDITING } from './words.i18n.ts';

/** "Add a feature": its name and one sentence; it goes to the end of the list with its code. */
export function AddFeature({ projectId, epicId }: { projectId: string; epicId: string }) {
  const t = useMessages(PLAN_EDITING);
  const command = useCommand<{ code: string }>(projectId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    command.mutate(
      { command: 'planned_feature.add', data: { epic_id: epicId, name: name.trim(), summary: summary.trim() } },
      {
        onSuccess: (r) => {
          announce(t.added(name.trim(), (r.result as { code?: string } | undefined)?.code ?? ''));
          setName('');
          setSummary('');
          setOpen(false);
        },
      },
    );
  };
  if (!open) {
    return (
      <div>
        <Button size="sm" onClick={() => setOpen(true)} data-add-feature>
          {t.add}
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" data-add-feature-form>
      <Field label={t.name} hint={t.nameHint}>
        {(p) => <TextInput {...p} value={name} maxLength={120} required onChange={(x) => setName(x.target.value)} />}
      </Field>
      <Field label={t.summary} hint={t.summaryHint}>
        {(p) => <TextInput {...p} value={summary} maxLength={500} required onChange={(x) => setSummary(x.target.value)} />}
      </Field>
      {command.error ? <ErrorNotice error={command.error} /> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" pending={command.isPending} pendingLabel={t.adding}>
          {t.addIt}
        </Button>
        <Button type="button" variant="quiet" size="sm" onClick={() => setOpen(false)}>
          {t.cancel}
        </Button>
      </div>
    </form>
  );
}

/** Up, down and drop, for a feature of the list not designed yet. */
export function LineControls({
  projectId,
  line,
  index,
  count,
}: {
  projectId: string;
  line: EpicLine;
  index: number;
  count: number;
}) {
  const t = useMessages(PLAN_EDITING);
  const command = useCommand(projectId);
  const [confirming, setConfirming] = useState(false);
  const move = (position: number) =>
    command.mutate({ command: 'planned_feature.move', entityId: line.id, data: { position } });
  const drop = () =>
    command.mutate(
      { command: 'planned_feature.drop', entityId: line.id, data: {} },
      { onSuccess: () => announce(t.dropped(line.name)) },
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-line-controls>
      {confirming ? (
        <>
          <span className="text-sm text-fg-2">{t.dropAsk}</span>
          <Button size="sm" variant="quiet" pending={command.isPending} onClick={drop}>
            {t.dropYes}
          </Button>
          <Button size="sm" variant="quiet" onClick={() => setConfirming(false)}>
            {t.cancel}
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" variant="quiet" disabled={index === 0 || command.isPending} onClick={() => move(index)} aria-label={t.moveUp(line.name)}>
            ↑
          </Button>
          <Button
            size="sm"
            variant="quiet"
            disabled={index === count - 1 || command.isPending}
            onClick={() => move(index + 2)}
            aria-label={t.moveDown(line.name)}
          >
            ↓
          </Button>
          {line.row === null ? (
            <Button size="sm" variant="quiet" onClick={() => setConfirming(true)}>
              {t.drop}
            </Button>
          ) : null}
        </>
      )}
      {command.error ? <ErrorNotice error={command.error} compact /> : null}
    </span>
  );
}
