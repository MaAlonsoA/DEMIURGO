// The Glossary tab: the words the person fixed and the English term DEMIURGO uses for each. Records
// are always written in English; the agents that write them and the translator follow these terms,
// so a word always comes out the same way. Setting or removing a word is the person's decision and
// leaves its event in the journal.

import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useCommand } from '../../api/commands.ts';
import { glossaryQuery } from '../../api/queries.ts';
import { canCreate } from '../../api/tables.ts';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Field, TextInput } from '../../components/Field.tsx';
import { LanguagesIcon, TrashIcon } from '../../components/icons.tsx';
import { ErrorNotice } from '../../components/Notice.tsx';
import { Bone, Skeleton } from '../../components/Spinner.tsx';
import { Who } from '../../components/Who.tsx';
import { messages, useMessages } from '../../i18n/define.ts';
import { useTables } from '../../lib/hooks.ts';

const WORDS = messages(
  {
    intro:
      'Records are always written in English. Fix here the English term for a word of your project, and DEMIURGO will use it every time it writes or translates.',
    loading: 'Loading the glossary',
    emptyTitle: 'No words fixed yet',
    emptyBody: 'Add a word when DEMIURGO translates it in a way that is not how your project says it.',
    term: 'Word',
    termHint: 'As you say it, in your language.',
    english: 'English term',
    note: 'Note',
    add: 'Fix the term',
    adding: 'Fixing…',
    remove: (term: string) => `Remove ${term}`,
    removed: (term: string) => `${term} is no longer in the glossary.`,
    added: (term: string, english: string) => `${term} is now written as ${english}.`,
    listLabel: 'Glossary',
  },
  {
    intro:
      'Los registros se escriben siempre en inglés. Fija aquí el término inglés de una palabra de tu proyecto y DEMIURGO lo usará cada vez que escriba o traduzca.',
    loading: 'Cargando el glosario',
    emptyTitle: 'Aún no hay palabras fijadas',
    emptyBody: 'Añade una palabra cuando DEMIURGO la traduzca de una forma que no es como la dice tu proyecto.',
    term: 'Palabra',
    termHint: 'Como la dices, en tu idioma.',
    english: 'Término en inglés',
    note: 'Nota',
    add: 'Fijar el término',
    adding: 'Fijando…',
    remove: (term: string) => `Quitar ${term}`,
    removed: (term: string) => `${term} ya no está en el glosario.`,
    added: (term: string, english: string) => `${term} se escribe ahora como ${english}.`,
    listLabel: 'Glosario',
  },
);

export function GlossaryTab({ projectId }: { projectId: string }) {
  const t = useMessages(WORDS);
  const list = useQuery(glossaryQuery(projectId));
  const tables = useTables();
  const command = useCommand(projectId);
  const [term, setTerm] = useState('');
  const [english, setEnglish] = useState('');
  const [note, setNote] = useState('');
  const canSet = tables ? canCreate(tables, 'glossary.set') : false;

  if (list.error) return <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />;
  if (list.isPending) {
    return (
      <Skeleton label={t.loading}>
        <Bone className="h-40 w-full rounded-lg" />
      </Skeleton>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const data = { term: term.trim(), english: english.trim(), ...(note.trim() ? { note: note.trim() } : {}) };
    command.mutate(
      { command: 'glossary.set', data },
      {
        onSuccess: () => {
          announce(t.added(data.term, data.english));
          setTerm('');
          setEnglish('');
          setNote('');
        },
      },
    );
  };
  const remove = (word: string) =>
    command.mutate({ command: 'glossary.remove', data: { term: word } }, { onSuccess: () => announce(t.removed(word)) });

  const entries = list.data ?? [];
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-2xl text-sm text-fg-2">{t.intro}</p>
      {canSet ? (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3" data-glossary-form>
          <Field label={t.term} hint={t.termHint} className="min-w-44 flex-1">
            {(p) => <TextInput {...p} value={term} maxLength={120} required onChange={(e) => setTerm(e.target.value)} />}
          </Field>
          <Field label={t.english} className="min-w-44 flex-1">
            {(p) => <TextInput {...p} value={english} maxLength={120} required onChange={(e) => setEnglish(e.target.value)} />}
          </Field>
          <Field label={t.note} optional className="min-w-60 flex-[2]">
            {(p) => <TextInput {...p} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <Button type="submit" variant="primary" pending={command.isPending} pendingLabel={t.adding}>
            {t.add}
          </Button>
        </form>
      ) : null}
      {command.error ? <ErrorNotice error={command.error} /> : null}
      {entries.length === 0 ? (
        <EmptyState icon={<LanguagesIcon size={20} />} title={t.emptyTitle}>
          {t.emptyBody}
        </EmptyState>
      ) : (
        <ul aria-label={t.listLabel} className="flex flex-col divide-y divide-edge-subtle rounded-lg border border-edge bg-panel">
          {entries.map((g) => (
            <li key={g.term} data-glossary-term={g.term} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <span className="font-medium text-fg">{g.term}</span>
              <span aria-hidden className="text-fg-3">
                →
              </span>
              <span className="text-fg">{g.english}</span>
              {g.note ? <span className="basis-full text-sm text-fg-2">{g.note}</span> : null}
              <span className="ml-auto flex items-center gap-2 text-xs text-fg-3">
                <Who actor={g.set_by} size={16} />
                {canSet ? (
                  <Button
                    size="sm"
                    variant="quiet"
                    icon={<TrashIcon size={14} />}
                    aria-label={t.remove(g.term)}
                    onClick={() => remove(g.term)}
                  />
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
