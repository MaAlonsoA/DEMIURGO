// The start of a design system, before there is one: two ways, each opens a thread with DEMIURGO.
// The thread is marked by its purpose (`Design system: start from <name>` / `Design system: from
// scratch`, see domain/public-design-systems.ts) and its first message says the chosen path.
// The public systems' URLs and licenses are checked in that domain file.

import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { DESIGN_SYSTEM_PURPOSE, PUBLIC_DESIGN_SYSTEMS, designSystemPurpose } from '../../../../domain/src/public-design-systems.ts';
import { runCommand } from '../../api/commands.ts';
import { keys, stateQuery } from '../../api/queries.ts';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { messages, useMessages } from '../../i18n/define.ts';

const START = messages(
  {
    title: 'No design system yet',
    intro: 'A design system is chosen once and then every screen is built from it. There are two ways to start.',
    publicTitle: 'Start from a public system',
    publicBody: 'Adopt a published, documented system as the base and give it your own personality.',
    start: (name: string) => `Start from ${name}`,
    site: 'Site',
    license: 'License',
    scratchTitle: 'Design from scratch',
    scratchBody: 'Define the principles, tokens, components and patterns of the product yourself, guided by DEMIURGO.',
    scratch: 'Design from scratch',
    started: 'DEMIURGO is asking about the principles in the new thread.',
  },
  {
    title: 'Todavía no hay sistema de diseño',
    intro: 'El sistema de diseño se elige una vez y de él sale cada pantalla. Hay dos maneras de empezar.',
    publicTitle: 'Partir de un sistema público',
    publicBody: 'Adoptar como base un sistema publicado y documentado, y darle tu propia personalidad.',
    start: (name: string) => `Partir de ${name}`,
    site: 'Sitio',
    license: 'Licencia',
    scratchTitle: 'Diseñarlo desde cero',
    scratchBody: 'Definir tú los principios, los tokens, los componentes y los patrones del producto, guiado por DEMIURGO.',
    scratch: 'Diseñarlo desde cero',
    started: 'DEMIURGO pregunta por los principios en el hilo nuevo.',
  },
);

export function DesignSystemStart({ projectId }: { projectId: string }) {
  const t = useMessages(START);
  const client = useQueryClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const begin = async (base: string | null) => {
    setPending(base ?? '');
    setError(null);
    try {
      // Fresh: a design-system thread opened before is found and continued, not opened twice.
      const state = await client.fetchQuery({ ...stateQuery(projectId), staleTime: 0 });
      let thread = state.explorations.find((e) => e.state === 'active' && e.purpose.startsWith(`${DESIGN_SYSTEM_PURPOSE}:`))?.id;
      if (!thread) {
        thread = (await runCommand(projectId, { command: 'exploration.open', data: { purpose: designSystemPurpose(base) } })).entity_id;
        const text = base ? `Design system: start from ${base}` : 'Design system: design from scratch';
        await runCommand(projectId, { command: 'message.post', data: { exploration_id: thread, text, respond: true } });
        announce(t.started);
      }
      void client.invalidateQueries({ queryKey: keys.project(projectId) });
      void navigate({ to: '/p/$projectId/threads/$explorationId', params: { projectId, explorationId: thread } });
    } catch (e) {
      setError(e);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-fg">{t.title}</h2>
        <p className="max-w-prose text-fg-2">{t.intro}</p>
      </div>
      <section className="flex flex-col gap-2" aria-labelledby="ds-public">
        <h3 id="ds-public" className="font-semibold text-fg">
          {t.publicTitle}
        </h3>
        <p className="max-w-prose text-fg-2">{t.publicBody}</p>
        <ul className="flex flex-col divide-y divide-edge border-y border-edge">
          {PUBLIC_DESIGN_SYSTEMS.map((s) => (
            <li key={s.name} data-public-system={s.name} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium text-fg">
                  {s.name} <span className="font-normal text-fg-2">({s.by})</span>
                </span>
                <span className="text-sm text-fg-2">
                  {t.site}:{' '}
                  <a href={s.url} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">
                    {s.url.replace('https://', '')}
                  </a>{' '}
                  · {t.license}: {s.license}
                </span>
              </div>
              <Button size="sm" variant="secondary" pending={pending === s.name} disabled={pending !== null} onClick={() => void begin(s.name)}>
                {t.start(s.name)}
              </Button>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2" aria-labelledby="ds-scratch">
        <h3 id="ds-scratch" className="font-semibold text-fg">
          {t.scratchTitle}
        </h3>
        <p className="max-w-prose text-fg-2">{t.scratchBody}</p>
        <div>
          <Button variant="primary" pending={pending === ''} disabled={pending !== null} onClick={() => void begin(null)}>
            {t.scratch}
          </Button>
        </div>
      </section>
      {error ? <ErrorNotice error={error} compact /> : null}
    </div>
  );
}
