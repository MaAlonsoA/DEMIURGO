// Design stages (design engine): the fixed stages in order, with the coverage of their mandatory
// questions and a way into each stage's thread. Passing a stage is the person's decision and the
// server only allows it once every mandatory question is confirmed or discarded.

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import { useCommand } from '../../api/commands.ts';
import { stagesQuery } from '../../api/queries.ts';
import type { StageRow } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { Button } from '../../ui/Button.tsx';
import { Reasons } from '../../ui/Reasons.tsx';

export function DesignStages({ projectId }: { projectId: string }) {
  const id = useId();
  const stages = useQuery(stagesQuery(projectId)).data;
  const command = useCommand(projectId);
  if (!stages) return null;
  const started = stages.some((s) => s.state !== 'not_started');
  const current = stages.find((s) => s.state === 'open');

  return (
    <section aria-labelledby={id} data-design-stages className="mb-8 flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 id={id} className="dm-text-caption font-semibold text-muted">
            Product design
            {current && <span className="font-normal"> · now: {current.title}</span>}
          </h2>
          <p className="dm-text-small text-ink-3">
            What holds for the whole product. Each feature then has its own requirements, checks and Ready to build.
          </p>
        </div>
        {!started && (
          <Button
            variant="secondary"
            disabled={command.isPending}
            onClick={() => command.mutate({ command: 'stage.open', data: { stage: stages[0]?.key } })}
          >
            Start design stages
          </Button>
        )}
      </div>
      <ol className="grid grid-cols-5 gap-3 max-[1439px]:grid-cols-3">
        {stages.map((s) => (
          <StageCard
            key={s.key}
            projectId={projectId}
            stage={s}
            onPass={(stageId) => command.mutate({ command: 'stage.pass', entityId: stageId })}
            pending={command.isPending}
          />
        ))}
      </ol>
      {command.error ? <Reasons error={command.error} /> : null}
    </section>
  );
}

function StageCard({
  projectId,
  stage: s,
  onPass,
  pending,
}: {
  projectId: string;
  stage: StageRow;
  onPass: (stageId: string) => void;
  pending: boolean;
}) {
  const ready = s.state === 'open' && s.covered === s.total;
  return (
    <li
      data-stage={s.key}
      data-state={s.state}
      className={cn(
        'flex flex-col gap-1.5 rounded-card-md border px-3.5 py-3',
        s.state === 'open' ? 'border-line-strong bg-surface' : 'border-line',
        s.state === 'not_started' && 'dm-faded',
      )}
    >
      <span className="dm-label">
        {s.position + 1} · {s.state === 'passed' ? 'Passed' : s.state === 'open' ? 'Open' : 'Not started'}
      </span>
      <span className="dm-text-body font-semibold">{s.title}</span>
      <span className="dm-text-small text-ink-3">{s.produces}</span>
      <span className="dm-text-small text-ink-2">
        {s.covered}/{s.total} questions answered
      </span>
      {s.state !== 'not_started' && (
        <div className="mt-1 flex items-center gap-2">
          {s.exploration_id && (
            <Link
              to="/p/$projectId/threads/$explorationId"
              params={{ projectId, explorationId: s.exploration_id }}
              className="dm-text-small font-semibold text-needs hover:text-needs-strong"
            >
              Open thread
            </Link>
          )}
          {s.state === 'open' && s.id && (
            <Button variant={ready ? 'primary' : 'text'} disabled={pending} onClick={() => s.id && onPass(s.id)}>
              Pass stage
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
