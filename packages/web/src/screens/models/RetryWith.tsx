// «Retry with…» (FDR-AGE-002, INV-RUN-08, INV-MODELS-21): the same context pack, once, on another
// engine chosen from what the providers offer; what runs the agent next time doesn't change. A
// non-modal popover by its trigger (components/Menu Popover): the engine starts on the run's own,
// the error stays inside (without taking the focus, which would close it) and is cleared each time
// it opens. Used on the run page and on the thread's failed run cards: the export and its props
// stay as they are.

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { type Engine, providersQuery } from '../../api/models.ts';
import { Button } from '../../components/Button.tsx';
import { RetryIcon } from '../../components/icons.tsx';
import { Popover } from '../../components/Menu.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { EngineSelect } from './EngineSelect.tsx';
import { choosableProviders, firstEngine } from './engines.ts';

type RetriableRun = { id: string; provider: string; requested_model?: string | null; effort?: string | null };

export function RetryWith({
  projectId,
  run,
  onRetried,
}: {
  projectId: string;
  run: RetriableRun;
  onRetried?: (runId: string) => void;
}) {
  const catalogs = useQuery(providersQuery).data?.catalogs ?? [];
  const command = useCommand<{ runId: string }>(projectId);
  const [open, setOpen] = useState(false);
  const [engine, setEngine] = useState<Engine | null>(null);
  const initial = (): Engine | null =>
    run.requested_model
      ? { provider: run.provider, model: run.requested_model, effort: run.effort ?? null }
      : firstEngine(catalogs, choosableProviders(catalogs)[0]?.provider ?? '');
  const retry = () => {
    if (!engine) return;
    command.mutate(
      { command: 'run.retry', data: { run_id: run.id, override: engine } },
      {
        onSuccess: (res) => {
          setOpen(false);
          onRetried?.(res.result?.runId ?? res.entity_id);
        },
      },
    );
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setEngine(initial());
          command.reset();
        }
      }}
      align="end"
      label="Retry with another engine"
      className="w-96"
      trigger={
        <Button variant="secondary" data-retry-with>
          Retry with…
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold text-fg">Retry with another engine</p>
          <p className="text-sm text-fg-2">Same context, just this once. What runs this agent next time doesn’t change.</p>
        </div>
        <EngineSelect
          label="Retry with"
          layout="stack"
          catalogs={catalogs}
          value={engine}
          onChange={setEngine}
          disabled={command.isPending}
        />
        {command.error ? <ErrorNotice error={command.error} compact focus={false} /> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="quiet" onClick={() => setOpen(false)}>
            Not now
          </Button>
          <Button
            variant="primary"
            icon={<RetryIcon size={14} />}
            data-command="run.retry"
            disabled={!engine}
            pending={command.isPending}
            pendingLabel="Retrying…"
            onClick={retry}
          >
            Retry
          </Button>
        </div>
      </div>
    </Popover>
  );
}
