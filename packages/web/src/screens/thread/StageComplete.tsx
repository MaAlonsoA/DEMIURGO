// The thread's design stage is complete (DESIGN.md §3.3; INV-THR-36): every mandatory question is
// covered, and passing it is the person's call. Passing is decisive, so it asks first and says what
// comes next (INVENTORY §2 #24, R22).

import { useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import type { StageRow } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { Card } from '../../components/Card.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { CheckCircleIcon } from '../../components/icons.tsx';

export function StageComplete({ projectId, stage, next }: { projectId: string; stage: StageRow; next: string | null }) {
  const command = useCommand(projectId);
  const [confirming, setConfirming] = useState(false);
  return (
    <Card tone="accent" data-stage-complete={stage.key} className="flex flex-col gap-3">
      <p className="flex items-start gap-2 text-base text-fg">
        <CheckCircleIcon size={16} className="mt-0.5 shrink-0 text-accent-text" />
        <span>
          <span className="font-semibold">
            {stage.title} is complete: {stage.covered} of {stage.total} answered.
          </span>{' '}
          You can pass the stage{next ? `; next comes ${next}` : ''}.
        </span>
      </p>
      <Button
        variant="primary"
        className="self-start"
        disabled={!stage.id}
        onClick={() => {
          command.reset();
          setConfirming(true);
        }}
      >
        Pass stage
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Pass ${stage.title}?`}
        description={
          <p>
            Its answers stay as they are, confirmed by you.{' '}
            {next ? `${next} opens next, with its own questions in this thread.` : 'It is the last design stage.'}
          </p>
        }
        confirm="Pass stage"
        pendingLabel="Passing…"
        pending={command.isPending}
        error={confirming ? command.error : null}
        onConfirm={() =>
          stage.id &&
          command.mutate(
            { command: 'stage.pass', entityId: stage.id },
            {
              onSuccess: () => {
                setConfirming(false);
                announce(next ? `${stage.title} passed. ${next} opens next.` : `${stage.title} passed.`);
              },
            },
          )
        }
      />
    </Card>
  );
}
