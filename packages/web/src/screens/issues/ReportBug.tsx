// "Report a bug": a dialog that opens an issue of kind bug and goes to its page.

import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useEffect, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { Dialog } from '../../components/Dialog.tsx';
import { Field, TextArea, TextInput } from '../../components/Field.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { useMessages } from '../../i18n/define.ts';
import { codeOf } from './logic.ts';
import { ISSUES, REPORT } from './words.i18n.ts';

export function ReportBugButton({
  projectId,
  task,
  size = 'md',
  variant = 'secondary',
}: {
  projectId: string;
  /** Prefills the task code (from a task page). */
  task?: string;
  size?: 'sm' | 'md';
  variant?: 'primary' | 'secondary' | 'quiet';
}) {
  const t = useMessages(ISSUES);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} data-report-bug onClick={() => setOpen(true)}>
        {t.reportBug}
      </Button>
      <ReportBugDialog projectId={projectId} open={open} onOpenChange={setOpen} {...(task ? { task } : {})} />
    </>
  );
}

function ReportBugDialog({
  projectId,
  open,
  onOpenChange,
  task,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: string;
}) {
  const t = useMessages(REPORT);
  const navigate = useNavigate();
  const command = useCommand<{ code: string }>(projectId);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [taskCode, setTaskCode] = useState(task ?? '');
  const [featureCode, setFeatureCode] = useState('');
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setBody('');
    setTaskCode(task ?? '');
    setFeatureCode('');
    setMissing(false);
    command.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (command.isPending) return;
    if (title.trim() === '') {
      setMissing(true);
      return;
    }
    const taskC = codeOf(taskCode);
    const featureC = codeOf(featureCode);
    command.mutate(
      {
        command: 'issue.open',
        data: {
          kind: 'bug',
          title: title.trim(),
          ...(body.trim() ? { body: body.trim() } : {}),
          ...(taskC ? { task: taskC } : {}),
          ...(featureC && !taskC ? { feature: featureC } : {}),
        },
      },
      {
        onSuccess: (response) => {
          const code = response.result?.code;
          onOpenChange(false);
          if (code) {
            announce(t.reported(code));
            void navigate({ to: '/p/$projectId/issues/$code', params: { projectId, code } });
          }
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t.title} description={t.description}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t.titleLabel} error={missing && title.trim() === '' ? t.titleRequired : undefined}>
          {(p) => <TextInput {...p} value={title} placeholder={t.titlePlaceholder} onChange={(e) => setTitle(e.target.value)} autoFocus />}
        </Field>
        <Field label={t.bodyLabel} hint={t.bodyHint} optional>
          {(p) => <TextArea {...p} rows={4} value={body} onChange={(e) => setBody(e.target.value)} />}
        </Field>
        <Field label={t.taskLabel} hint={t.taskHint} optional>
          {(p) => <TextInput {...p} value={taskCode} onChange={(e) => setTaskCode(e.target.value)} />}
        </Field>
        {codeOf(taskCode) ? null : (
          <Field label={t.featureLabel} hint={t.featureHint} optional>
            {(p) => <TextInput {...p} value={featureCode} onChange={(e) => setFeatureCode(e.target.value)} />}
          </Field>
        )}
        {command.error ? <ErrorNotice error={command.error} compact /> : null}
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={() => onOpenChange(false)} disabled={command.isPending}>
            {t.cancel}
          </Button>
          <Button type="submit" variant="primary" pending={command.isPending} pendingLabel={t.pending}>
            {t.submit}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
