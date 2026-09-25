// "What do you want to build?" (DESIGN.md §1 J5, §3.9): the first thing a new person sees of
// DEMIURGO, in the workspace frame (so Sign out is at hand). One question: the idea in the person's
// words and a name for the project. Start creates the project, opens its first thread with the idea
// as its purpose and posts the idea for DEMIURGO to read (the durable response runs
// exploration_chat with the onboarding agent). What was already created is remembered in this tab,
// with what was written: trying again — also after choosing an engine in Models & providers — never
// creates a second project (INVENTORY §10). Nothing is decided here: the reassurances say so.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { request } from '../../api/client.ts';
import { runCommand } from '../../api/commands.ts';
import { projectsQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import { Button } from '../../components/Button.tsx';
import { Field, TextArea, TextInput } from '../../components/Field.tsx';
import { ArrowRightIcon, PencilIcon, ShieldIcon } from '../../components/icons.tsx';
import { ErrorNotice, Notice } from '../../components/Notice.tsx';
import { usePageTitle } from '../../components/Page.tsx';
import { StateIcon } from '../../components/status.tsx';
import { cn } from '../../lib/cn.ts';
import { useTables } from '../../lib/hooks.ts';
import { WorkspaceFrame } from '../../shell/WorkspaceFrame.tsx';
import { IDEA_EXAMPLES, MESSAGE_MAX, purposeOf } from './day.ts';
import { live } from './live.ts';

const NAME_MAX = 120;
const DRAFT = 'dm-new-project';

type Draft = { idea: string; name: string; projectId?: string; explorationId?: string };

function readDraft(): Draft {
  try {
    const raw = sessionStorage.getItem(DRAFT);
    const d = raw ? (JSON.parse(raw) as Partial<Draft>) : {};
    return {
      idea: typeof d.idea === 'string' ? d.idea : '',
      name: typeof d.name === 'string' ? d.name : '',
      ...(typeof d.projectId === 'string' ? { projectId: d.projectId } : {}),
      ...(typeof d.explorationId === 'string' ? { explorationId: d.explorationId } : {}),
    };
  } catch {
    return { idea: '', name: '' };
  }
}

function writeDraft(d: Draft | null): void {
  try {
    if (d) sessionStorage.setItem(DRAFT, JSON.stringify(d));
    else sessionStorage.removeItem(DRAFT);
  } catch {
    // Storage may be unavailable: the draft then lasts for this visit only.
  }
}

type Missing = null | 'idea' | 'name';

export function NewProjectScreen() {
  usePageTitle(['New project']);
  const client = useQueryClient();
  const navigate = useNavigate();
  const tables = useTables();
  const [draft] = useState(readDraft);
  const [idea, setIdea] = useState(draft.idea);
  const [name, setName] = useState(draft.name);
  const [missing, setMissing] = useState<Missing>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  // What already exists if a step failed: trying again does not create a second project or thread.
  const done = useRef<{ projectId?: string; explorationId?: string }>({
    ...(draft.projectId ? { projectId: draft.projectId } : {}),
    ...(draft.explorationId ? { explorationId: draft.explorationId } : {}),
  });
  const [created, setCreated] = useState(Boolean(draft.projectId));
  const ideaRef = useRef<HTMLTextAreaElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const examplesId = useId();
  const allowed =
    !tables ||
    (canCreate(tables, 'project.create') && canCreate(tables, 'exploration.open') && canCreate(tables, 'message.post'));
  // A known project still in the list: a restored draft of one that is gone starts over.
  const projects = useQuery(projectsQuery).data;
  useEffect(() => {
    if (!projects || !done.current.projectId) return;
    if (!projects.some((p) => p.id === done.current.projectId)) {
      done.current = {};
      setCreated(false);
    }
  }, [projects]);

  // What was written stays in this tab (a trip to Models & providers, a reload), until it starts.
  useEffect(() => {
    if (pending) return;
    writeDraft(idea || name || done.current.projectId ? { idea, name, ...done.current } : null);
  }, [idea, name, created, pending]);

  const fill = (e: (typeof IDEA_EXAMPLES)[number]) => {
    setIdea(e.idea);
    if (!created && (!name.trim() || IDEA_EXAMPLES.some((x) => x.name === name))) setName(e.name);
    setMissing(null);
    ideaRef.current?.focus();
  };

  const start = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (!idea.trim()) {
      setMissing('idea');
      ideaRef.current?.focus();
      return;
    }
    if (!name.trim() && !done.current.projectId) {
      setMissing('name');
      nameRef.current?.focus();
      return;
    }
    setMissing(null);
    setError(null);
    setPending(true);
    try {
      let { projectId, explorationId } = done.current;
      if (!projectId) {
        projectId = (await request<{ project_id: string }>('POST', '/api/projects', { name: name.trim() })).project_id;
        done.current.projectId = projectId;
        setCreated(true);
      }
      if (!explorationId) {
        explorationId = (await runCommand(projectId, { command: 'exploration.open', data: { purpose: purposeOf(idea) } }))
          .entity_id;
        done.current.explorationId = explorationId;
      }
      await runCommand(projectId, {
        command: 'message.post',
        // Day 1: the onboarding agent reads the idea (FDR-AGE-002).
        data: { exploration_id: explorationId, text: idea.trim(), respond: true, agent: 'onboarding' },
      });
      live.start(explorationId);
      writeDraft(null);
      // The project's area checks the project exists: the list is fetched again first.
      await client.fetchQuery({ ...projectsQuery, staleTime: 0 });
      await navigate({ to: '/p/$projectId/start/$explorationId', params: { projectId, explorationId } });
    } catch (err) {
      writeDraft({ idea, name, ...done.current });
      setError(err);
      setPending(false);
      // The project may already exist (the message is what failed): it shows in Your projects.
      void client.invalidateQueries({ queryKey: projectsQuery.queryKey });
    }
  };

  return (
    <WorkspaceFrame current="new">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-10 pb-16 sm:px-6 sm:pt-16">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-accent-text">New project</p>
          <h1 id="page-title" tabIndex={-1} className="text-3xl font-semibold text-fg outline-none">
            What do you want to build?
          </h1>
          <p className="max-w-2xl text-md text-fg-2">
            Describe it in your own words, like you would to a friend. DEMIURGO turns it into a plan you can see, correct and
            build.
          </p>
        </div>

        <form noValidate onSubmit={(e) => void start(e)} aria-labelledby="page-title" className="flex flex-col gap-6">
          <Field
            label="Describe your idea"
            error={missing === 'idea' ? 'Describe your idea to start.' : undefined}
            count={idea.length > MESSAGE_MAX * 0.9 ? [idea.length, MESSAGE_MAX] : undefined}
          >
            {(p) => (
              <TextArea
                {...p}
                ref={ideaRef}
                rows={5}
                autoGrow
                maxRows={16}
                maxLength={MESSAGE_MAX}
                value={idea}
                placeholder="An app where… It helps… People use it to…"
                className="px-4 py-3 text-md"
                onChange={(e) => {
                  setIdea(e.target.value);
                  if (missing === 'idea') setMissing(null);
                }}
              />
            )}
          </Field>

          <div className="flex flex-col gap-2">
            <p id={examplesId} className="text-sm text-fg-2">
              Or start from an example:
            </p>
            <div role="group" aria-labelledby={examplesId} className="flex flex-wrap gap-2">
              {IDEA_EXAMPLES.map((e) => {
                const on = idea === e.idea;
                return (
                  <button
                    key={e.label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => fill(e)}
                    className={cn(
                      'inline-flex h-8 cursor-pointer items-center rounded-full border px-3 text-sm font-medium transition-colors duration-[var(--m-fast)]',
                      on
                        ? 'border-accent bg-accent-soft text-accent-text'
                        : 'border-edge-strong bg-panel text-fg-2 hover:border-edge-control hover:text-fg',
                    )}
                  >
                    {e.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-4 border-t border-edge pt-6 sm:flex-row sm:items-start">
            <Field
              label="Name"
              className="sm:w-80"
              hint={created ? 'The project already exists with this name. You can rename it later.' : 'You can rename it later.'}
              error={missing === 'name' ? 'Give the project a name to start.' : undefined}
            >
              {(p) => (
                <TextInput
                  {...p}
                  ref={nameRef}
                  value={name}
                  maxLength={NAME_MAX}
                  autoComplete="off"
                  placeholder="A short name"
                  readOnly={created}
                  className={cn('h-10', created && 'bg-sunken text-fg-2')}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (missing === 'name') setMissing(null);
                  }}
                />
              )}
            </Field>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={!allowed}
              pending={pending}
              pendingLabel="Starting…"
              trailing={<ArrowRightIcon size={16} />}
              className="sm:mt-6 sm:ml-auto"
            >
              Start
            </Button>
          </div>

          {error ? <ErrorNotice error={error} modelsHref="/models" /> : null}
          {allowed ? null : <Notice tone="neutral">Only a person can start a project.</Notice>}
        </form>

        <ul aria-label="Before you start" className="flex flex-col gap-3 text-sm text-fg-2 sm:flex-row sm:flex-wrap sm:gap-x-8">
          <li className="flex items-center gap-2">
            <StateIcon kind="proposed" size={15} />
            Nothing is decided until you confirm it
          </li>
          <li className="flex items-center gap-2">
            <PencilIcon size={15} className="shrink-0 text-fg-3" />
            You can change anything later
          </li>
          <li className="flex items-center gap-2">
            <ShieldIcon size={15} className="shrink-0 text-fg-3" />
            Everything stays here, saved
          </li>
        </ul>
      </div>
    </WorkspaceFrame>
  );
}
