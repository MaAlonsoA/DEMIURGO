// "What do you want to build?" (canvas S4A): the first thing a new person sees of DEMIURGO. One
// question, the idea in the person's words and a name for the project (project.create needs one,
// and there is no rename yet). Start creates the project, opens its first thread with the idea as
// its purpose and posts the idea for DEMIURGO to read (the durable response runs exploration_chat).
// Nothing is decided here: the reassurances say so.

import { Chip, Icon } from '@demiurgo/design-system';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useId, useRef, useState } from 'react';
import { request } from '../../api/client.ts';
import { runCommand } from '../../api/commands.ts';
import { projectsQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import { useTables } from '../../lib/hooks.ts';
import { Button } from '../../ui/Button.tsx';
import { ArrowRight, LockIcon } from '../../ui/icons.tsx';
import { MarkGlyph } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';
import { IDEA_EXAMPLES, MESSAGE_MAX, purposeOf } from './day.ts';
import { live } from './live.ts';

type Missing = null | 'idea' | 'name';

export function NewProjectScreen() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const tables = useTables();
  const projects = useQuery(projectsQuery).data ?? [];
  const [idea, setIdea] = useState('');
  const [name, setName] = useState('');
  const [example, setExample] = useState<string | null>(null);
  const [missing, setMissing] = useState<Missing>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  // What already exists if a step failed: trying again does not create a second project or thread.
  const done = useRef<{ projectId?: string; explorationId?: string }>({});
  const ideaRef = useRef<HTMLTextAreaElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const ideaId = useId();
  const nameId = useId();
  const hintId = useId();
  const allowed =
    !tables ||
    (canCreate(tables, 'project.create') && canCreate(tables, 'exploration.open') && canCreate(tables, 'message.post'));

  const fill = (e: (typeof IDEA_EXAMPLES)[number]) => {
    setIdea(e.idea);
    if (!name.trim() || name === example) setName(e.name);
    setExample(e.name);
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
      }
      if (!explorationId) {
        explorationId = (await runCommand(projectId, { command: 'exploration.open', data: { purpose: purposeOf(idea) } }))
          .entity_id;
        done.current.explorationId = explorationId;
      }
      const posted = await runCommand(projectId, {
        command: 'message.post',
        // Day 1: the onboarding agent reads the idea (FDR-AGE-002).
        data: { exploration_id: explorationId, text: idea.trim(), respond: true, agent: 'onboarding' },
      });
      live.start(explorationId);
      live.sent(posted.entity_id);
      // The project's area checks the project exists: the list is fetched again first.
      await client.fetchQuery({ ...projectsQuery, staleTime: 0 });
      await navigate({ to: '/p/$projectId/start/$explorationId', params: { projectId, explorationId } });
    } catch (err) {
      setError(err);
      setPending(false);
      // The project may already exist (the message is what failed): it shows in Your projects.
      void client.invalidateQueries({ queryKey: projectsQuery.queryKey });
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between px-7">
        <span className="dm-text-wordmark">DEMIURGO</span>
        <nav aria-label="Workspace" className="dm-text-body flex items-center gap-5 font-medium text-ink-3">
          <Link to="/models" className="hover:text-ink">
            Models &amp; providers
          </Link>
          {projects.length > 0 && (
            <Link to="/projects" className="hover:text-ink">
              Your projects
            </Link>
          )}
        </nav>
      </header>
      <main id="main" className="flex flex-1 justify-center px-6 pt-[92px] pb-24">
        <form onSubmit={(e) => void start(e)} className="flex w-[760px] flex-col gap-[22px]" aria-labelledby={`${ideaId}-title`}>
          <div className="flex flex-col gap-2.5">
            <span className="dm-text-small font-semibold text-muted">New project</span>
            <h1 id={`${ideaId}-title`} className="dm-text-display">
              What do you want to build?
            </h1>
            <p className="dm-text-heading text-ink-2 font-normal">
              Describe it in your own words, like you would to a friend. DEMIURGO turns it into a plan you can see, correct and
              build.
            </p>
          </div>

          {/* The idea box is the design system's panel, lifted; writing in it draws the selection outline. */}
          <div className="dm-panel border-line-strong px-5 pt-5 pb-3.5 shadow-raised has-[textarea:focus-visible]:border-needs has-[textarea:focus-visible]:shadow-selected">
            <label htmlFor={ideaId} className="sr-only">
              Describe your idea
            </label>
            <textarea
              ref={ideaRef}
              id={ideaId}
              value={idea}
              onChange={(e) => {
                setIdea(e.target.value);
                if (missing === 'idea') setMissing(null);
              }}
              rows={5}
              maxLength={MESSAGE_MAX}
              placeholder="An app where… It helps… People use it to…"
              aria-invalid={missing === 'idea' || undefined}
              className="dm-text-heading w-full resize-none bg-transparent font-normal text-ink outline-none placeholder:text-muted"
            />
            <div className="flex items-center justify-between gap-3 border-t border-line-soft pt-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <label htmlFor={nameId} className="dm-text-small font-semibold text-ink-2">
                  Name
                </label>
                <input
                  ref={nameRef}
                  id={nameId}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (missing === 'name') setMissing(null);
                  }}
                  maxLength={120}
                  autoComplete="off"
                  placeholder="A short name"
                  aria-describedby={hintId}
                  aria-invalid={missing === 'name' || undefined}
                  className="dm-text-body h-9 w-[220px] rounded-control border border-line-strong bg-surface px-2.5 text-ink placeholder:text-muted focus:border-needs focus:outline-none"
                />
                <span id={hintId} className="dm-text-caption text-muted">
                  You can&apos;t rename it yet.
                </span>
              </div>
              <Button type="submit" variant="primary" disabled={pending || !allowed}>
                {pending ? 'Starting…' : 'Start'}
                <ArrowRight size={16} />
              </Button>
            </div>
          </div>

          {missing && (
            <p role="alert" className="dm-text-small -mt-2 font-medium text-problem">
              {missing === 'idea' ? 'Describe your idea to start.' : 'Give the project a name to start.'}
            </p>
          )}
          {error ? <Reasons error={error} className="-mt-2" /> : null}
          {!allowed && <p className="dm-text-small -mt-2 text-ink-2">Only a person can start a project.</p>}

          <div className="flex flex-wrap items-center gap-2.5">
            <span className="dm-text-small text-muted">Or start from an example:</span>
            {IDEA_EXAMPLES.map((e) => (
              // A short choice: the design system's Chip, ink while the idea is that example.
              <Chip key={e.label} pressed={idea === e.idea} onClick={() => fill(e)}>
                {e.label}
              </Chip>
            ))}
          </div>

          <ul className="dm-text-small mt-[18px] flex gap-7 text-ink-3">
            <li className="flex items-center gap-2">
              <MarkGlyph kind="proposed" />
              Nothing is decided until you confirm it
            </li>
            <li className="flex items-center gap-2">
              <Icon name="needs-review" size={14} stroke={2} />
              You can change anything later
            </li>
            <li className="flex items-center gap-2">
              <LockIcon size={14} />
              Everything stays here, saved
            </li>
          </ul>
        </form>
      </main>
    </div>
  );
}
