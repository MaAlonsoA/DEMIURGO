// "Copy the brief": puts the brief of a ready feature on the clipboard, to build it outside.

import { useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { fetchBrief } from '../../api/queries.ts';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { CopyIcon } from '../../components/icons.tsx';
import { messages, useMessages } from '../../i18n/define.ts';
import { copyText } from './brief.ts';

const WORDS = messages(
  {
    copy: 'Copy the brief',
    copied: (code: string) => `Brief of ${code} copied: paste it where it will be built.`,
    failed: 'The brief could not be copied.',
    hint: 'Ready to build: copy its brief and build it outside (a person, or an agent in the project repository). Then record the evidence of each check.',
  },
  {
    copy: 'Copiar encargo',
    copied: (code: string) => `Encargo de ${code} copiado: pégalo donde se vaya a construir.`,
    failed: 'No se pudo copiar el encargo.',
    hint: 'Lista para construir: copia su encargo y constrúyela fuera (una persona, o un agente en el repositorio del proyecto). Después apunta la evidencia de cada comprobación.',
  },
);

export const BRIEF_WORDS = WORDS;

export function CopyBriefButton({ projectId, code, size, label }: { projectId: string; code: string; size?: 'sm'; label?: string }) {
  const t = useMessages(WORDS);
  const [pending, setPending] = useState(false);
  const copy = async () => {
    if (pending) return;
    setPending(true);
    try {
      // The server composes it from the current state and refuses it, with why, if it is not ready.
      const brief = await fetchBrief(projectId, code);
      await copyText(brief);
      announce(t.copied(code));
    } catch (e) {
      announce(e instanceof ApiError && e.reasons.length > 0 ? `${t.failed} ${e.reasons.join(' ')}` : t.failed);
    } finally {
      setPending(false);
    }
  };
  return (
    <Button size={size} icon={<CopyIcon size={14} />} pending={pending} onClick={() => void copy()} data-copy-brief={code} aria-label={label}>
      {t.copy}
    </Button>
  );
}

/** On the page of a ready feature: the hint and the button. */
export function BriefCard({ projectId, code }: { projectId: string; code: string }) {
  const t = useMessages(WORDS);
  return (
    <div data-brief className="flex flex-wrap items-center gap-3 rounded-lg border border-accent-edge bg-accent-soft px-4 py-3">
      <p className="min-w-0 flex-1 text-sm text-fg">{t.hint}</p>
      <CopyBriefButton projectId={projectId} code={code} size="sm" />
    </div>
  );
}
