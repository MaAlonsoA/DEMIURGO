// «Open the app»: the project's main running in its own container with its own database (core
// preview/preview.ts). Start, then the local address as a link, the commit it runs, the seed note and Stop.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../api/client.ts';
import { type PreviewState, previewQuery } from '../../api/queries.ts';
import { Button } from '../../components/Button.tsx';
import { Code } from '../../components/Badge.tsx';
import { ErrorNotice, Notice } from '../../components/Notice.tsx';
import { Section } from '../../components/Page.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import { useMessages } from '../../i18n/define.ts';
import { REPOSITORY } from './words.i18n.ts';

/** What the section shows for each state of the app: pure, so it is tested without a server. */
export function PreviewView({ state, pending, error, onStart, onStop }: { state: PreviewState; pending?: boolean; error?: unknown; onStart: () => void; onStop: () => void }) {
  const t = useMessages(REPOSITORY);
  return (
    <Section title={t.previewTitle}>
      <div data-preview={state.state} className="flex flex-col gap-3 text-sm text-fg">
        <p className="max-w-prose text-fg-2">{t.previewNote}</p>
        {state.state === 'starting' ? (
          <p data-preview-progress className="inline-flex items-center gap-2 text-fg-2">
            <Spinner />
            {t.previewStarting(state.step)}
          </p>
        ) : null}
        {state.state === 'running' ? (
          <div className="flex flex-col gap-1">
            <a data-preview-url href={state.url} target="_blank" rel="noreferrer" className="underline">
              {state.url}
            </a>
            <p className="text-fg-2">
              {t.previewCommit} <Code>{state.commit.slice(0, 7)}</Code>
            </p>
            {state.accounts && state.accounts.length > 0 ? (
              <div data-preview-accounts className="mt-2 flex flex-col gap-1">
                <p className="text-fg-2">{t.previewAccounts}</p>
                {state.accounts.map((a) => (
                  <p key={a.email}>
                    {a.role}: <Code>{a.email}</Code> · <Code>{a.password}</Code>
                  </p>
                ))}
              </div>
            ) : (
              <p data-preview-seed className="text-fg-2">
                {state.seed ? t.previewSeeded(state.seed) : t.previewSeedNote}
              </p>
            )}
          </div>
        ) : null}
        {state.state === 'failed' ? (
          <Notice tone="danger" title={t.previewFailed}>
            <p>{state.reason}</p>
            {state.log ? (
              <>
                <p className="mt-2 text-fg-2">{t.previewLog}</p>
                <pre data-preview-log className="whitespace-pre-wrap font-code text-xs text-fg-2">
                  {state.log}
                </pre>
              </>
            ) : null}
          </Notice>
        ) : null}
        {state.state === 'stopped' ? <p className="text-fg-2">{t.previewStopped}</p> : null}
        <div className="flex gap-2">
          {state.state !== 'starting' ? (
            <Button variant={state.state === 'running' ? 'secondary' : 'primary'} pending={pending === true} onClick={onStart}>
              {state.state === 'running' ? t.previewRestart : t.previewStart}
            </Button>
          ) : null}
          {state.state === 'running' || state.state === 'starting' ? (
            <Button variant="quiet" onClick={onStop}>
              {t.previewStop}
            </Button>
          ) : null}
        </div>
        {error ? <ErrorNotice error={error} /> : null}
      </div>
    </Section>
  );
}

export function PreviewSection({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const q = useQuery(previewQuery(projectId));
  const refresh = () => client.invalidateQueries({ queryKey: ['p', projectId, 'preview'] });
  const start = useMutation({ mutationFn: () => request('POST', `/api/projects/${projectId}/preview`, {}), onSettled: refresh });
  const stop = useMutation({ mutationFn: () => request('DELETE', `/api/projects/${projectId}/preview`), onSettled: refresh });
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;
  return <PreviewView state={q.data} pending={start.isPending} error={start.error ?? stop.error} onStart={() => start.mutate()} onStop={() => stop.mutate()} />;
}
