// The «?» help button of an Observability section and the panel it opens: what the section measures, how it is
// computed, how to read it and where the rule comes from (help.i18n.ts). It reuses the app's Dialog, which traps the
// focus, closes on Esc and gives the focus back to the button. The global «?» key (shell/Help.tsx) is left alone
// everywhere except inside this panel, where it would stack the app help on top of it.

import { type ReactNode, useState } from 'react';
import { Dialog } from '../../components/Dialog.tsx';
import { HelpIcon } from '../../components/icons.tsx';
import { useMessages } from '../../i18n/define.ts';
import { type HelpTopic, OBS_HELP } from './help.i18n.ts';

function Lines({ text }: { text: string }) {
  const lines = text.split('\n');
  return lines.length === 1 ? (
    <p>{text}</p>
  ) : (
    <ul className="flex list-disc flex-col gap-1.5 pl-5">
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-sm font-medium text-fg">{title}</h3>
      <div className="flex flex-col gap-1.5 text-sm text-fg-2">{children}</div>
    </section>
  );
}

/** The help button of a section; `title` is the section's name (it names the button and the panel). */
export function SectionHelp({ topic, title }: { topic: HelpTopic; title: string }) {
  const t = useMessages(OBS_HELP);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={t.button(title)}
        aria-haspopup="dialog"
        data-help-topic={topic}
        onClick={() => setOpen(true)}
        className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg focus-visible:outline-2"
      >
        <HelpIcon size={16} />
      </button>
      <Dialog open={open} onOpenChange={setOpen} title={title} description={t.description(title)} wide>
        <div
          className="flex flex-col gap-4"
          onKeyDown={(e) => {
            if (e.key === '?') e.stopPropagation();
          }}
        >
          <Part title={t.whatLabel}>
            <Lines text={t[`${topic}Measures`]} />
          </Part>
          <Part title={t.howLabel}>
            <Lines text={t[`${topic}How`]} />
          </Part>
          <Part title={t.readLabel}>
            <Lines text={t[`${topic}Read`]} />
          </Part>
          <Part title={t.sourceLabel}>
            <Lines text={t[`${topic}Source`]} />
          </Part>
        </div>
      </Dialog>
    </>
  );
}
