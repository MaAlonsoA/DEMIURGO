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
import { ErrorNotice } from '../../components/Notice.tsx';
import { CheckCircleIcon } from '../../components/icons.tsx';
import { useContentMessages, useMessages } from '../../i18n/define.ts';
import { FIRST_FEATURE, STAGE_COMPLETE } from './words.i18n.ts';

export function StageComplete({ projectId, stage, next }: { projectId: string; stage: StageRow; next: string | null }) {
  const t = useMessages(STAGE_COMPLETE);
  const command = useCommand(projectId);
  const [confirming, setConfirming] = useState(false);
  return (
    <Card tone="accent" data-stage-complete={stage.key} className="flex flex-col gap-3">
      <p className="flex items-start gap-2 text-base text-fg">
        <CheckCircleIcon size={16} className="mt-0.5 shrink-0 text-accent-text" />
        <span>
          <span className="font-semibold">{t.complete(stage.title, stage.covered, stage.total)}</span>
          {t.canPass(next)}
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
        {t.passStage}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t.passTitle(stage.title)}
        description={<p>{t.passDescription(next)}</p>}
        confirm={t.passStage}
        pendingLabel={t.passing}
        pending={command.isPending}
        error={confirming ? command.error : null}
        onConfirm={() =>
          stage.id &&
          command.mutate(
            { command: 'stage.pass', entityId: stage.id },
            {
              onSuccess: () => {
                setConfirming(false);
                announce(t.passed(stage.title, next));
              },
            },
          )
        }
      />
    </Card>
  );
}

/**
 * After the onboarding, while no feature thread hangs from this one: the next step is designing the
 * first feature. The button asks DEMIURGO where to start; its reply offers the candidates from the
 * definition's first version, each one a thread the person can open.
 */
export function FirstFeature({ projectId, explorationId }: { projectId: string; explorationId: string }) {
  const t = useMessages(FIRST_FEATURE);
  const request = useContentMessages(FIRST_FEATURE).request;
  const post = useCommand(projectId);
  return (
    <Card tone="accent" data-first-feature className="flex flex-col gap-3">
      <p className="flex items-start gap-2 text-base text-fg">
        <CheckCircleIcon size={16} className="mt-0.5 shrink-0 text-accent-text" />
        <span>
          <span className="font-semibold">{t.done}</span>
          {t.next}
        </span>
      </p>
      <Button
        variant="primary"
        className="self-start"
        disabled={post.isPending}
        onClick={() =>
          post.mutate(
            { command: 'message.post', data: { exploration_id: explorationId, text: request, respond: true } },
            { onSuccess: () => announce(t.asked) },
          )
        }
      >
        {t.ask}
      </Button>
      {post.error ? <ErrorNotice error={post.error} compact /> : null}
    </Card>
  );
}
