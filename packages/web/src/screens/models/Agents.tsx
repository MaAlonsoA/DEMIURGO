// "Who does what" (INV-MODELS-09…17; DESIGN.md §3.9): which engine runs each part of DEMIURGO,
// everywhere and — inside a project — here. A change still applies at once, as before, but it is
// announced and stays written in the row ("Explorer now uses Codex · GPT-6 · medium everywhere.")
// so a slip is seen. Each part shows its name with its id, what it runs on now, and its skills and
// limits. Rows stack on narrow widths instead of clipping a column (INVENTORY §14, UX problems).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { type AgentInfo, type Catalog, type Engine, assignEngine, unassignEngine } from '../../api/models.ts';
import { announce } from '../../components/announce.tsx';
import { Code } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { CheckCircleIcon, ChevronRightIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { StateIcon } from '../../components/status.tsx';
import { cn } from '../../lib/cn.ts';
import { ACTION_WORDS } from '../../words.ts';
import { EngineSelect } from './EngineSelect.tsx';
import { changeWords, choosableProviders, firstEngine, resolutionLine } from './engines.ts';

type Change = { scope: 'global' | 'project'; engine: Engine | null };

const minutes = (s: number) => (s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);

export function AgentRow({
  agent: a,
  catalogs,
  skills,
  projectId,
}: {
  agent: AgentInfo;
  catalogs: Catalog[];
  skills: { id: string; description: string }[];
  projectId?: string;
}) {
  const client = useQueryClient();
  const [changed, setChanged] = useState<string | null>(null);
  const done = async (change: Change) => {
    await client.invalidateQueries({ queryKey: ['models'] });
    const words = changeWords(a.section, change, catalogs);
    setChanged(words);
    announce(words);
  };
  const assign = useMutation({
    mutationFn: (p: { scope: 'global' | 'project'; engine: Engine }) => assignEngine(a.id, p.scope, p.engine, projectId),
    onSuccess: (_r, p) => done({ scope: p.scope, engine: p.engine }),
  });
  const unassign = useMutation({
    mutationFn: (scope: 'global' | 'project') => unassignEngine(a.id, scope, projectId),
    onSuccess: (_r, scope) => done({ scope, engine: null }),
  });
  const busy = assign.isPending || unassign.isPending;
  const error = assign.error ?? unassign.error;
  const line = resolutionLine(a.effective, catalogs);
  const fallback = a.global?.engine ?? firstEngine(catalogs, choosableProviders(catalogs)[0]?.provider ?? '') ?? null;
  const change = (scope: 'global' | 'project', engine: Engine) => {
    unassign.reset();
    assign.mutate({ scope, engine });
  };
  const remove = (scope: 'global' | 'project') => {
    assign.reset();
    unassign.mutate(scope);
  };
  const own = skills.filter((s) => a.skills.includes(s.id));

  return (
    <li
      data-agent={a.id}
      aria-labelledby={`agent-${a.id}`}
      className={cn(
        'grid gap-x-6 gap-y-4 border-b border-edge-subtle py-5 first:pt-1 last:border-b-0',
        projectId
          ? 'md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_minmax(0,1.3fr)_minmax(0,1.3fr)]'
          : 'md:grid-cols-[minmax(220px,1fr)_minmax(0,1.6fr)]',
      )}
    >
      <div className={cn('flex min-w-0 flex-col gap-1', projectId && 'md:col-span-2 xl:col-span-1')}>
        <h3 id={`agent-${a.id}`} className="text-base font-semibold text-fg">
          {a.section}
        </h3>
        <p className="text-sm text-fg-2">{a.description}</p>
        <Code>
          {a.id}@{a.version} · {a.skills.length} {a.skills.length === 1 ? 'skill' : 'skills'}
        </Code>
        <p
          data-effective
          className={cn(
            'mt-1 flex items-start gap-1.5 text-sm',
            line.tone === 'ok' ? 'text-fg-2' : 'font-medium text-danger-text',
          )}
        >
          <StateIcon kind={line.tone === 'ok' ? 'done' : 'problem'} size={14} className="mt-0.5" />
          <span>
            <span className="sr-only">{line.tone === 'ok' ? 'Runs on: ' : 'Cannot run: '}</span>
            {line.text}
          </span>
        </p>
        {changed ? (
          <p data-changed className="flex items-start gap-1.5 text-sm text-success-text">
            <CheckCircleIcon size={14} className="mt-0.5 shrink-0" />
            <span>
              <span className="font-medium">Applied just now: </span>
              {changed}
            </span>
          </p>
        ) : null}
        <details className="group mt-1">
          <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1 text-sm font-medium text-fg-2 hover:text-fg [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon size={12} className="transition-transform group-open:rotate-90" />
            Skills and limits
          </summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-fg-2">Does</dt>
            <dd className="text-fg">{ACTION_WORDS[a.action] ?? a.action}</dd>
            <dt className="text-fg-2">Conversation</dt>
            <dd className="text-fg">
              {a.session === 'thread' ? 'Keeps a conversation per thread' : 'Sends the whole context every time'}
            </dd>
            <dt className="text-fg-2">Time limit</dt>
            <dd className="text-fg tabular-nums">Stopped after {minutes(a.time_limit)}</dd>
            <dt className="text-fg-2">Skills</dt>
            <dd className="text-fg">
              {own.length === 0 && a.skills.length === 0 ? (
                <span className="text-fg-3">None</span>
              ) : (
                <ul className="flex flex-col gap-1">
                  {(own.length > 0 ? own : a.skills.map((id) => ({ id, description: '' }))).map((s) => (
                    <li key={s.id}>
                      <Code className="text-fg">{s.id}</Code>
                      {s.description ? <span className="text-fg-2"> · {s.description}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </dl>
        </details>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-sm font-medium text-fg">Everywhere</p>
        <EngineSelect
          label={`${a.section}, everywhere`}
          catalogs={catalogs}
          value={a.global?.engine ?? null}
          disabled={busy}
          onChange={(engine) => change('global', engine)}
        />
        {a.global ? (
          <Button
            size="sm"
            variant="quiet"
            className="self-start"
            disabled={busy}
            aria-label={`Remove the engine of ${a.section} everywhere`}
            onClick={() => remove('global')}
          >
            Remove
          </Button>
        ) : (
          <p className="text-sm font-medium text-danger-text">No model yet</p>
        )}
      </div>

      {projectId ? (
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm font-medium text-fg">This project</p>
          {a.project ? (
            <>
              <EngineSelect
                label={`${a.section}, this project`}
                catalogs={catalogs}
                value={a.project.engine}
                disabled={busy}
                onChange={(engine) => change('project', engine)}
              />
              <Button size="sm" variant="quiet" className="self-start" disabled={busy} onClick={() => remove('project')}>
                Use everywhere’s
              </Button>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-sm text-fg-2">Same as everywhere</span>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || !fallback}
                onClick={() => fallback && change('project', fallback)}
              >
                Use another here
              </Button>
              {!fallback ? <span className="text-sm text-fg-3">No engine to choose yet.</span> : null}
            </div>
          )}
        </div>
      ) : null}

      {error ? <ErrorNotice error={error} compact className="md:col-span-full" /> : null}
    </li>
  );
}
