// The person's own words an inference or a change rests on: quoted whole, since the server checked
// they are what the person wrote. A long one shows its first lines and unfolds with "Show more".

import { useState } from 'react';
import { useMessages } from '../i18n/define.ts';
import { cn } from '../lib/cn.ts';
import { QUOTE } from './words.i18n.ts';

const LONG = 240;

export function Quote({ text }: { text: string }) {
  const t = useMessages(QUOTE);
  const [all, setAll] = useState(false);
  const long = text.length > LONG || text.split('\n').length > 3;
  return (
    <span className="flex flex-col items-start gap-0.5">
      <q className={cn('whitespace-pre-wrap break-words', long && !all && 'line-clamp-3')}>{text}</q>
      {long ? (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((a) => !a)}
          className="cursor-pointer text-xs font-medium text-accent-text hover:underline"
        >
          {all ? t.showLess : t.showMore}
        </button>
      ) : null}
    </span>
  );
}
