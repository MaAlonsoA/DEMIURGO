// Agent keys of a project: an external agent (Claude Code, Codex…) reads the project and proposes
// through MCP with its own key, never accepting or approving anything. A key's secret is shown only
// once, when issued, next to the line that sets up MCP; revoking it stops it at once.

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { tokensQuery } from '../../api/queries.ts';
import type { AgentToken } from '../../api/types.ts';
import { useProjectId } from '../../lib/hooks.ts';
import { ago } from '../../lib/time.ts';
import { Button } from '../../ui/Button.tsx';
import { Code } from '../../ui/Card.tsx';
import { ConfirmDialog, TextDialog } from '../../ui/dialogs.tsx';
import { PlusIcon } from '../../ui/icons.tsx';
import { EmptyState, Page, PageTitle, Skeleton } from '../../ui/layout.tsx';
import { Mark } from '../../ui/marks.tsx';
import { Reasons } from '../../ui/Reasons.tsx';

type Issued = { name: string; token: string };

/** What sets up MCP for an agent, from the DEMIURGO folder. */
export function mcpSetup(origin: string, projectId: string, token: string): string {
  return `claude mcp add demiurgo -e DEMIURGO_API_URL=${origin} -e DEMIURGO_AGENT_TOKEN=${token} -e DEMIURGO_PROJECT=${projectId} -- node packages/mcp/src/main.ts`;
}

export function AgentKeysScreen() {
  const projectId = useProjectId();
  const tokens = useQuery(tokensQuery(projectId));
  const issue = useCommand<{ token: string; actor: string }>(projectId);
  const revoke = useCommand(projectId);
  const [naming, setNaming] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [revoking, setRevoking] = useState<AgentToken | null>(null);
  const list = tokens.data ?? [];

  return (
    <Page className="[&>*]:max-w-[900px]">
      <PageTitle
        eyebrow="The product"
        title="Agent keys"
        subtitle="An agent with a key reads this project and proposes through MCP, with its own name. It never accepts or approves anything: that stays with you."
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              issue.reset();
              setNaming(true);
            }}
          >
            <PlusIcon size={14} />
            New key
          </Button>
        }
      />

      {issued && (
        <section
          role="status"
          aria-label={`The key of ${issued.name}`}
          data-issued-key
          className="dm-card mb-6 gap-3 border-needs px-5 py-4"
        >
          <p className="dm-text-body font-semibold">The key of {issued.name}. It is shown only this once: copy it now.</p>
          <div className="flex items-center gap-2">
            <span data-secret className="min-w-0 flex-1 truncate">
              <Code>{issued.token}</Code>
            </span>
            <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(issued.token)}>
              Copy
            </Button>
          </div>
          <p className="dm-text-small text-ink-2">To use it from Claude Code, run this in the DEMIURGO folder:</p>
          <Code className="block break-all whitespace-pre-wrap">{mcpSetup(window.location.origin, projectId, issued.token)}</Code>
          <Button variant="text" className="self-start" onClick={() => setIssued(null)}>
            I have saved it
          </Button>
        </section>
      )}

      {tokens.error ? <Reasons error={tokens.error} /> : null}
      {tokens.isPending ? (
        <Skeleton className="h-24 w-full rounded-card" />
      ) : list.length === 0 ? (
        <EmptyState>No agent has a key yet. Give one to Claude Code to let it propose through MCP.</EmptyState>
      ) : (
        <ul aria-label="Keys" className="flex flex-col divide-y divide-line-soft rounded-card border border-line bg-surface">
          {list.map((t) => (
            <li key={t.id} data-agent-key={t.name} data-key-state={t.state} className="flex items-center gap-3 px-5 py-3">
              <Mark kind={t.state === 'active' ? 'done' : 'dropped'} label={t.state === 'active' ? 'Active' : 'Revoked'} />
              <span className="min-w-0 flex-1">
                <span className="dm-text-body font-semibold">{t.name}</span>
                <span className="dm-text-caption block text-muted">
                  {t.state === 'active' ? 'Active' : `Revoked ${t.revoked_at ? ago(t.revoked_at) : ''}`} · issued by{' '}
                  {t.issued_by.replace(/^human:/, '')} {ago(t.created_at)}
                </span>
              </span>
              {t.state === 'active' && (
                <Button variant="text" onClick={() => setRevoking(t)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <TextDialog
        open={naming}
        onOpenChange={setNaming}
        title="New agent key"
        description="The agent proposes with this name. Lowercase letters, numbers and hyphens."
        label="Name of the agent"
        submit="Create the key"
        required
        multiline={false}
        maxLength={40}
        pending={issue.isPending}
        error={naming ? issue.error : null}
        onSubmit={(name) =>
          issue.mutate(
            { command: 'agent_token.issue', data: { name } },
            {
              onSuccess: (r) => {
                if (r.result) setIssued({ name, token: r.result.token });
                setNaming(false);
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
        pending={revoke.isPending}
        error={revoke.error}
        onConfirm={() => {
          if (!revoking) return;
          revoke.mutate(
            { command: 'agent_token.revoke', entityId: revoking.id, data: {} },
            { onSuccess: () => setRevoking(null) },
          );
        }}
      />
    </Page>
  );
}
