// Agent keys (DESIGN.md §3.9; INV-KEYS-01…11): an external agent (Claude Code, Codex…) reads the
// project and proposes through MCP with its own key, never accepting or approving anything. A key's
// secret is shown only once, when issued, next to the line that sets up MCP; "Copy" says it
// copied (or why it couldn't), revoking asks first and stops the key at once. The focus never falls
// to the page's end: after "I have saved it" and after a revoke it goes to that key's row.

import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { projectsQuery, tokensQuery } from '../../api/queries.ts';
import type { AgentToken } from '../../api/types.ts';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { ConfirmDialog, PromptDialog } from '../../components/Dialog.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { CheckIcon, CopyIcon, KeyIcon, PlusIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { PageBody, PageHeader, Section, usePageTitle } from '../../components/Page.tsx';
import { RowsSkeleton } from '../../components/Spinner.tsx';
import { StatusBadge } from '../../components/status.tsx';
import { RelativeTime } from '../../components/Time.tsx';
import { useProjectId } from '../../lib/hooks.ts';

type Issued = { name: string; token: string };

/** What sets up MCP for an agent, from the DEMIURGO folder. */
export function mcpSetup(origin: string, projectId: string, token: string): string {
  return `claude mcp add demiurgo -e DEMIURGO_API_URL=${origin} -e DEMIURGO_AGENT_TOKEN=${token} -e DEMIURGO_PROJECT=${projectId} -- node packages/mcp/src/main.ts`;
}

/** Focus a key's row once the list shows it (the button that had the focus may be gone). */
function focusRow(name: string) {
  let tries = 0;
  const attempt = () => {
    const row = document.querySelector<HTMLElement>(`[data-agent-key="${CSS.escape(name)}"]`);
    if (row) row.focus();
    else if (tries++ < 10) setTimeout(attempt, 60);
  };
  setTimeout(attempt, 60);
}

/** A "Copy" button that says "Copied" for a moment, or that it couldn't. */
function CopyButton({ text, what }: { text: string; what: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copy = async () => {
    clearTimeout(timer.current);
    try {
      if (!navigator.clipboard) throw new Error('No clipboard');
      await navigator.clipboard.writeText(text);
      setState('copied');
      announce(`Copied ${what}.`);
      timer.current = setTimeout(() => setState('idle'), 2500);
    } catch {
      setState('failed');
      announce(`Couldn't copy ${what}. Select it and copy it by hand.`);
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        icon={state === 'copied' ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
        onClick={() => void copy()}
        aria-label={state === 'copied' ? `Copied ${what}` : `Copy ${what}`}
      >
        {state === 'copied' ? 'Copied' : 'Copy'}
      </Button>
      {state === 'failed' ? (
        <span className="text-sm text-danger-text">Couldn't copy it here. Select it and copy it by hand.</span>
      ) : null}
    </span>
  );
}

export function AgentKeysScreen() {
  const projectId = useProjectId();
  const project = (useQuery(projectsQuery).data ?? []).find((p) => p.id === projectId);
  usePageTitle(['Agent keys', project?.name]);
  const tokens = useQuery(tokensQuery(projectId));
  const issue = useCommand<{ token: string; actor: string }>(projectId);
  const revoke = useCommand(projectId);
  const [naming, setNaming] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [revoking, setRevoking] = useState<AgentToken | null>(null);
  const list = tokens.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <KeyIcon size={14} className="text-fg-3" />
            Settings
          </span>
        }
        title="Agent keys"
        meta={
          <span className="max-w-3xl">
            An agent with a key reads this project and proposes through MCP, with its own name. It never accepts or approves
            anything: that stays with you.
          </span>
        }
        actions={
          <Button
            variant="primary"
            icon={<PlusIcon size={14} />}
            onClick={() => {
              issue.reset();
              setNaming(true);
            }}
          >
            New key
          </Button>
        }
      />
      <PageBody width="full" className="mx-0 max-w-4xl">
        <div className="flex flex-col gap-8">
          {issued ? (
            <section
              role="status"
              aria-label={`The key of ${issued.name}`}
              data-issued-key
              className="flex flex-col gap-4 rounded-lg border border-accent-edge bg-accent-soft p-4"
            >
              <p className="text-base font-semibold text-fg">
                The key of {issued.name}. It is shown only this once: copy it now.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code
                  data-secret
                  className="min-w-0 flex-1 rounded-md border border-edge bg-panel px-3 py-2 font-code text-sm break-all text-fg"
                >
                  {issued.token}
                </code>
                <CopyButton text={issued.token} what="the key" />
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-sm text-fg-2">To use it from Claude Code, run this in the DEMIURGO folder:</p>
                <code className="block rounded-md border border-edge bg-panel px-3 py-2 font-code text-xs break-all whitespace-pre-wrap text-fg">
                  {mcpSetup(window.location.origin, projectId, issued.token)}
                </code>
                <span className="self-start">
                  <CopyButton text={mcpSetup(window.location.origin, projectId, issued.token)} what="the command" />
                </span>
              </div>
              <Button
                variant="secondary"
                className="self-start"
                onClick={() => {
                  const name = issued.name;
                  setIssued(null);
                  announce('The key is no longer on the page.');
                  focusRow(name);
                }}
              >
                I have saved it
              </Button>
            </section>
          ) : null}

          <Section title="Keys" id="keys">
            {tokens.isPending ? (
              <RowsSkeleton label="Loading the keys" rows={3} />
            ) : tokens.error && !tokens.data ? (
              <ErrorNotice error={tokens.error} onRetry={() => void tokens.refetch()} />
            ) : list.length === 0 ? (
              <EmptyState icon={<KeyIcon size={24} />} title="No agent has a key yet." headingLevel={3}>
                Give one to Claude Code to let it propose through MCP.
              </EmptyState>
            ) : (
              <ul aria-label="Keys" className="flex flex-col divide-y divide-edge-subtle rounded-lg border border-edge">
                {list.map((t) => (
                  <li
                    key={t.id}
                    data-agent-key={t.name}
                    data-key-state={t.state}
                    tabIndex={-1}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 outline-none focus-visible:outline-2"
                  >
                    <StatusBadge
                      kind={t.state === 'active' ? 'done' : 'dropped'}
                      word={t.state === 'active' ? 'Active' : 'Revoked'}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-code text-base font-medium text-fg">{t.name}</span>
                      <span className="text-sm text-fg-2">
                        {t.state === 'revoked' && t.revoked_at ? <RelativeTime iso={t.revoked_at} prefix="Revoked" /> : null}
                        {t.state === 'revoked' && t.revoked_at ? ' · ' : null}
                        Issued by {t.issued_by.replace(/^human:/, '')} <RelativeTime iso={t.created_at} />
                      </span>
                    </span>
                    {t.state === 'active' ? (
                      <Button
                        size="sm"
                        variant="quiet-danger"
                        aria-label={`Revoke the key of ${t.name}`}
                        onClick={() => {
                          revoke.reset();
                          setRevoking(t);
                        }}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </PageBody>

      <PromptDialog
        open={naming}
        onOpenChange={setNaming}
        title="New agent key"
        description="The agent proposes with this name. Lowercase letters, numbers and hyphens."
        label="Name of the agent"
        submit="Create the key"
        required
        multiline={false}
        maxLength={40}
        placeholder="claude-code"
        pending={issue.isPending}
        pendingLabel="Creating…"
        error={naming ? issue.error : null}
        onSubmit={(name) =>
          issue.mutate(
            { command: 'agent_token.issue', data: { name } },
            {
              onSuccess: (r) => {
                if (r.result) setIssued({ name, token: r.result.token });
                setNaming(false);
                announce(`Created the key of ${name}. Copy it now: it is shown only this once.`);
              },
            },
          )
        }
      />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title={`Revoke the key of ${revoking?.name ?? ''}?`}
        description="The agent can no longer read or propose with it. What it already proposed stays as it is."
        confirm="Revoke"
        tone="danger"
        pending={revoke.isPending}
        pendingLabel="Revoking…"
        error={revoke.error}
        onConfirm={() => {
          if (!revoking) return;
          const name = revoking.name;
          revoke.mutate(
            { command: 'agent_token.revoke', entityId: revoking.id, data: {} },
            {
              onSuccess: () => {
                setRevoking(null);
                announce(`Revoked the key of ${name}.`);
                focusRow(name);
              },
            },
          );
        }}
      />
    </>
  );
}
