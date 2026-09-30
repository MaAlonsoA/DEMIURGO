// The thread's design stage is complete (DESIGN.md §3.3; INV-THR-36): every mandatory question is
// covered, and passing it is the person's call. Passing is decisive, so it asks first and says what
// comes next (INVENTORY §2 #24, R22).

import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { stateQuery } from '../../api/queries.ts';
import type { StageRow } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Button, buttonClass } from '../../components/Button.tsx';
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

/** The path steps that come before the backlog, in order (domain inception keys). */
const BEFORE_BACKLOG: readonly string[] = ['definition', 'quality', 'principles', 'design_system'];

/**
 * After the onboarding, while no feature thread hangs from the main thread: the next step is designing
 * the first feature. The button asks DEMIURGO where to start, in the main thread (resumed first if it
 * was closed); its reply offers the candidates from the definition's first version, each one a thread
 * the person can open. It shows in that thread and on the product overview, which goes to the thread.
 */
export function FirstFeature({
  projectId,
  explorationId,
  active,
  goToThread = false,
}: {
  projectId: string;
  explorationId: string;
  active: boolean;
  goToThread?: boolean;
}) {
  const t = useMessages(FIRST_FEATURE);
  const current = useQuery(stateQuery(projectId)).data?.inception?.current ?? null;
  const request = useContentMessages(FIRST_FEATURE).request;
  const post = useCommand(projectId);
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const ask = async () => {
    setPending(true);
    try {
      if (!active) await post.mutateAsync({ command: 'exploration.resume', entityId: explorationId });
      await post.mutateAsync({ command: 'message.post', data: { exploration_id: explorationId, text: request, respond: true } });
      announce(t.asked);
      if (goToThread) void navigate({ to: '/p/$projectId/threads/$explorationId', params: { projectId, explorationId } });
    } catch {
      // The error shows under the button.
    } finally {
      setPending(false);
    }
  };
  // The path decides what comes next: before the backlog the next step is not the first feature.
  if (current !== null && BEFORE_BACKLOG.includes(current)) {
    if (current !== 'design_system') return null;
    return (
      <Card tone="accent" data-first-feature="design-system" className="flex flex-col gap-3">
        <p className="flex items-start gap-2 text-base text-fg">
          <CheckCircleIcon size={16} className="mt-0.5 shrink-0 text-accent-text" />
          <span>
            <span className="font-semibold">{t.done}</span>
            {t.nextDesignSystem}
          </span>
        </p>
        <Link to="/p/$projectId/design-system" params={{ projectId }} className={buttonClass({ variant: 'primary' })}>
          {t.goToDesignSystem}
        </Link>
      </Card>
    );
  }
  return (
    <Card tone="accent" data-first-feature className="flex flex-col gap-3">
      <p className="flex items-start gap-2 text-base text-fg">
        <CheckCircleIcon size={16} className="mt-0.5 shrink-0 text-accent-text" />
        <span>
          <span className="font-semibold">{t.done}</span>
          {t.next}
        </span>
      </p>
      <Button variant="primary" className="self-start" disabled={pending} onClick={() => void ask()}>
        {t.ask}
      </Button>
      {post.error ? <ErrorNotice error={post.error} compact /> : null}
    </Card>
  );
}
