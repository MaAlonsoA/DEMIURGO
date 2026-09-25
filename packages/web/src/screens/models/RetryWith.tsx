// «Retry with…» (FDR-AGE-002): the same context pack, once, on another engine chosen from what the
// providers offer. The agent's assignment doesn't change.

import { useQuery } from '@tanstack/react-query';
import { Popover } from 'radix-ui';
import { useId, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { type Engine, providersQuery } from '../../api/models.ts';
import { Button } from '../../ui/Button.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
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
  const titleId = useId();
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
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setEngine(initial());
          command.reset();
        }
      }}
    >
      <Popover.Trigger asChild>
        <Button variant="secondary" data-retry-with>
          Retry with…
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          aria-labelledby={titleId}
          className="dm-panel dm-float z-50 w-[440px] animate-fade-in"
        >
          <div className="flex flex-col gap-0.5">
            <p id={titleId} className="dm-text-heading">
              Retry with another engine
            </p>
            <p className="dm-text-small text-ink-2">
              Same context, just this once. What runs this agent next time doesn’t change.
            </p>
          </div>
          <EngineSelect label="Retry with" catalogs={catalogs} value={engine} onChange={setEngine} disabled={command.isPending} />
          {command.error ? <Reasons error={command.error} /> : null}
          <div className="flex justify-end gap-2">
            <Popover.Close asChild>
              <Button variant="text">Not now</Button>
            </Popover.Close>
            <Button variant="primary" data-command="run.retry" disabled={!engine || command.isPending} onClick={retry}>
              {command.isPending ? 'Retrying…' : 'Retry'}
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
