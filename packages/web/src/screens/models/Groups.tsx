// "Who does what" (INV-MODELS-09…17; DESIGN.md §3.9): the engine of each group of agents (Deep
// thinking, Quick…) and, inside each group, its tasks. A task follows its group's engine unless the
// person gives it its own ("Use another model"), an exception said in its row until it goes back
// ("Use the group's"). The backup engine works the same way: the group's, or a task's own; it runs
// only when the chosen engine can't answer. One choice for every project. Each change applies at
// once and is announced and written where it was made, so a slip is seen.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  type AgentGroup,
  type AgentInfo,
  type Catalog,
  type Engine,
  type EngineTarget,
  assignEngine,
  removeFallback,
  setFallback,
  unassignEngine,
} from '../../api/models.ts';
import { announce } from '../../components/announce.tsx';
import { Code } from '../../components/Badge.tsx';
import { Button } from '../../components/Button.tsx';
import { CheckCircleIcon, ChevronRightIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { StateIcon } from '../../components/status.tsx';
import { useMessages } from '../../i18n/define.ts';
import { cn } from '../../lib/cn.ts';
import { ACTION_WORDS } from '../../words.ts';
import { EngineSelect } from './EngineSelect.tsx';
import { changeWords, choosableProviders, fallbackChangeWords, fallbackLine, firstEngine, resolutionLine } from './engines.ts';
import { GROUPS } from './words.i18n.ts';

type Skills = { id: string; description: string }[];

/** Assigning and removing one engine choice, with the words of what it did. */
function useEngineChoice(target: EngineTarget, name: string, catalogs: readonly Catalog[]) {
  const client = useQueryClient();
  const [changed, setChanged] = useState<string | null>(null);
  const kind = 'group' in target ? 'group' : 'agent';
  const done = async (engine: Engine | null) => {
    await client.invalidateQueries({ queryKey: ['models'] });
    const words = changeWords(name, { kind, engine }, catalogs);
    setChanged(words);
    announce(words);
  };
  const assign = useMutation({ mutationFn: (engine: Engine) => assignEngine(target, engine), onSuccess: (_r, e) => done(e) });
  const unassign = useMutation({ mutationFn: () => unassignEngine(target), onSuccess: () => done(null) });
  return {
    changed,
    busy: assign.isPending || unassign.isPending,
    error: assign.error ?? unassign.error,
    set: (engine: Engine) => {
      unassign.reset();
      assign.mutate(engine);
    },
    clear: () => {
      assign.reset();
      unassign.mutate();
    },
  };
}

/** Setting and removing a backup engine, with the words of what it did. */
function useBackupChoice(target: EngineTarget, name: string, catalogs: readonly Catalog[], inGroup: boolean) {
  const client = useQueryClient();
  const [changed, setChanged] = useState<string | null>(null);
  const kind = 'group' in target ? 'group' : 'agent';
  const done = async (engine: Engine | null) => {
    await client.invalidateQueries({ queryKey: ['models'] });
    const words = fallbackChangeWords(name, { kind, engine, inGroup }, catalogs);
    setChanged(words);
    announce(words);
  };
  const set = useMutation({ mutationFn: (engine: Engine) => setFallback(target, engine), onSuccess: (_r, e) => done(e) });
  const remove = useMutation({ mutationFn: () => removeFallback(target), onSuccess: () => done(null) });
  return {
    changed,
    busy: set.isPending || remove.isPending,
    error: set.error ?? remove.error,
    set: (engine: Engine) => {
      remove.reset();
      set.mutate(engine);
    },
    clear: () => {
      set.reset();
      remove.mutate();
    },
  };
}

/** Where a new backup starts: the first model of another provider than the chosen engine's, else any. */
function backupStart(catalogs: readonly Catalog[], chosen: Engine | null): Engine | null {
  const providers = choosableProviders(catalogs);
  const other = providers.find((p) => p.provider !== chosen?.provider) ?? providers[0];
  return other ? firstEngine(catalogs, other.provider) : null;
}

function Changed({ words }: { words: string | null }) {
  const t = useMessages(GROUPS);
  if (!words) return null;
  return (
    <p data-changed className="flex items-start gap-1.5 text-sm text-success-text">
      <CheckCircleIcon size={14} className="mt-0.5 shrink-0" />
      <span>
        <span className="font-medium">{t.appliedNow}</span>
        {words}
      </span>
    </p>
  );
}

export function GroupCard({
  group,
  agents,
  catalogs,
  skills,
}: {
  group: AgentGroup;
  agents: readonly AgentInfo[];
  catalogs: Catalog[];
  skills: Skills;
}) {
  const t = useMessages(GROUPS);
  const choice = useEngineChoice({ group: group.id }, group.name, catalogs);
  const backup = useBackupChoice({ group: group.id }, group.name, catalogs, false);
  const engine = group.assignment?.engine ?? null;
  const fallback = group.fallback?.engine ?? null;
  const start = backupStart(catalogs, engine);
  return (
    <section
      data-group={group.id}
      aria-labelledby={`group-${group.id}`}
      className="flex min-w-0 flex-col gap-4 rounded-lg border border-edge bg-panel p-4 sm:p-5"
    >
      <header className="flex flex-col gap-1">
        <h3 id={`group-${group.id}`} className="text-lg font-semibold text-fg">
          {group.name}
        </h3>
        <p className="text-sm text-fg-2">{group.description}</p>
      </header>
      <div className="flex flex-col gap-2">
        <EngineSelect label={group.name} catalogs={catalogs} value={engine} disabled={choice.busy} onChange={choice.set} />
        {engine ? null : <p className="text-sm font-medium text-danger-text">{t.noEngineYet}</p>}
        <Changed words={choice.changed} />
        {choice.error ? <ErrorNotice error={choice.error} compact /> : null}
      </div>
      <div className="flex flex-col gap-2" data-group-backup={group.id}>
        <h4 className="text-sm font-semibold text-fg">{t.backupTitle}</h4>
        {fallback ? (
          <>
            <p className="text-sm text-fg-2">{t.backupIntro}</p>
            <EngineSelect
              label={t.backupOf(group.name)}
              catalogs={catalogs}
              value={fallback}
              disabled={backup.busy}
              onChange={backup.set}
            />
            <Button size="sm" variant="quiet" className="self-start" disabled={backup.busy} onClick={backup.clear}>
              {t.removeBackup}
            </Button>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-sm text-fg-2">{t.noBackup}</span>
            <Button
              size="sm"
              variant="secondary"
              disabled={backup.busy || !start}
              aria-label={t.addBackupFor(group.name)}
              onClick={() => start && backup.set(start)}
            >
              {t.addBackup}
            </Button>
          </div>
        )}
        <Changed words={backup.changed} />
        {backup.error ? <ErrorNotice error={backup.error} compact /> : null}
      </div>
      <ul aria-label={t.tasksIn(group.name)} className="flex flex-col border-t border-edge-subtle">
        {agents.map((a) => (
          <TaskRow key={a.id} agent={a} catalogs={catalogs} skills={skills} groupEngine={engine} groupFallback={fallback} />
        ))}
      </ul>
    </section>
  );
}

/** A task: what it runs on and where that comes from; its own engine when it is an exception. */
export function TaskRow({
  agent: a,
  catalogs,
  skills,
  groupEngine,
  groupFallback,
}: {
  agent: AgentInfo;
  catalogs: Catalog[];
  skills: Skills;
  /** Its group's engine, the starting point of an exception; null for a task without a group. */
  groupEngine: Engine | null;
  /** Its group's backup, which it takes unless it has its own; null without one. */
  groupFallback: Engine | null;
}) {
  const t = useMessages(GROUPS);
  const choice = useEngineChoice({ agent: a.id }, a.section, catalogs);
  const backup = useBackupChoice({ agent: a.id }, a.section, catalogs, !!a.group);
  const line = resolutionLine(a.effective, catalogs);
  const ownFallback = a.own_fallback?.engine ?? null;
  const fallback = fallbackLine(ownFallback, groupFallback, catalogs);
  const effective = a.effective && a.effective.status !== 'unassigned' ? a.effective : null;
  const backupFrom = fallback?.engine ?? backupStart(catalogs, effective);
  const start = groupEngine ?? firstEngine(catalogs, choosableProviders(catalogs)[0]?.provider ?? '');
  const own = skills.filter((s) => a.skills.includes(s.id));
  return (
    <li
      data-agent={a.id}
      aria-labelledby={`agent-${a.id}`}
      className="flex flex-col gap-2 border-b border-edge-subtle py-4 last:border-b-0 last:pb-0"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 id={`agent-${a.id}`} className="text-base font-semibold text-fg">
          {a.section}
        </h4>
        <Code className="text-fg-3">
          {a.id}@{a.version}
        </Code>
      </div>
      <p className="text-sm text-fg-2">{a.description}</p>
      <p
        data-effective
        className={cn('flex items-start gap-1.5 text-sm', line.tone === 'ok' ? 'text-fg-2' : 'font-medium text-danger-text')}
      >
        <StateIcon kind={line.tone === 'ok' ? 'done' : 'problem'} size={14} className="mt-0.5" />
        <span>
          <span className="sr-only">{line.tone === 'ok' ? t.runsOn : t.cannotRun}</span>
          {line.text}
        </span>
      </p>
      {fallback ? (
        <p data-backup className="text-sm text-fg-2">
          <span className="font-medium">{t.backup}</span>
          {fallback.text}
        </p>
      ) : null}
      {a.own ? (
        <div className="flex flex-col gap-2">
          <EngineSelect
            label={t.ownModel(a.section)}
            catalogs={catalogs}
            value={a.own.engine}
            disabled={choice.busy}
            onChange={choice.set}
          />
          {a.group ? (
            <Button size="sm" variant="quiet" className="self-start" disabled={choice.busy} onClick={choice.clear}>
              {t.useGroups}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={choice.busy || !start}
            aria-label={a.group ? t.useAnotherFor(a.section) : t.chooseFor(a.section)}
            onClick={() => start && choice.set(start)}
          >
            {a.group ? t.useAnother : t.chooseOne}
          </Button>
          {!start ? <span className="text-sm text-fg-3">{t.noEngineToChoose}</span> : null}
        </div>
      )}
      <Changed words={choice.changed} />
      {choice.error ? <ErrorNotice error={choice.error} compact /> : null}
      {ownFallback ? (
        <div className="flex flex-col gap-2">
          <EngineSelect
            label={t.ownBackup(a.section)}
            catalogs={catalogs}
            value={ownFallback}
            disabled={backup.busy}
            onChange={backup.set}
          />
          <Button size="sm" variant="quiet" className="self-start" disabled={backup.busy} onClick={backup.clear}>
            {a.group ? t.useGroupsBackup : t.removeBackup}
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="quiet"
          className="self-start"
          disabled={backup.busy || !backupFrom}
          aria-label={fallback ? t.useAnotherBackupFor(a.section) : t.addBackupFor(a.section)}
          onClick={() => backupFrom && backup.set(backupFrom)}
        >
          {fallback ? t.useAnotherBackup : t.addBackup}
        </Button>
      )}
      <Changed words={backup.changed} />
      {backup.error ? <ErrorNotice error={backup.error} compact /> : null}
      <details className="group">
        <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1 text-sm font-medium text-fg-2 hover:text-fg [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon size={12} className="transition-transform group-open:rotate-90" />
          {t.skillsAndLimits}
        </summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-fg-2">{t.does}</dt>
          <dd className="text-fg">{ACTION_WORDS[a.action] ?? a.action}</dd>
          <dt className="text-fg-2">{t.conversation}</dt>
          <dd className="text-fg">{a.session === 'thread' ? t.keepsConversation : t.sendsWholeContext}</dd>
          <dt className="text-fg-2">{t.timeLimit}</dt>
          <dd className="text-fg tabular-nums">
            {t.stoppedAfter(a.time_limit >= 60 ? t.minutes(Math.round(a.time_limit / 60)) : t.seconds(a.time_limit))}
          </dd>
          <dt className="text-fg-2">{t.skills}</dt>
          <dd className="text-fg">
            {own.length === 0 && a.skills.length === 0 ? (
              <span className="text-fg-3">{t.none}</span>
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
    </li>
  );
}
