// The version picker of the record header (INV-REC-05): "v2 · Draft ▾", and a menu of every version,
// newest first, with its state in words, "current", its date and who wrote and approved it.
// Choosing one shows it (?v=N).

import { useNavigate } from '@tanstack/react-router';
import type { RecordDetail, RecordVersion } from '../../api/types.ts';
import { Code } from '../../components/Badge.tsx';
import { buttonClass } from '../../components/Button.tsx';
import { ChevronDownIcon } from '../../components/icons.tsx';
import { Menu, MenuItem, MenuLabel } from '../../components/Menu.tsx';
import { StateIcon } from '../../components/status.tsx';
import { whoName } from '../../components/Who.tsx';
import { shortDate } from '../../lib/time.ts';
import { stateWord, whoOf } from '../../words.ts';

const by = (actor: string) => {
  const who = whoOf(actor);
  return who.kind === 'you' ? 'you' : whoName(who);
};

export function VersionPicker({ projectId, record, shown }: { projectId: string; record: RecordDetail; shown: RecordVersion }) {
  const navigate = useNavigate();
  const w = stateWord('record_version', shown.state);
  return (
    <Menu
      align="end"
      label="Versions"
      trigger={
        <button
          type="button"
          aria-label={`Version ${shown.n} of ${record.versions.length} · choose another`}
          className={buttonClass({ variant: 'secondary' })}
        >
          <StateIcon kind={w.mark} />
          <Code className="text-fg">v{shown.n}</Code>
          <span className="text-fg-2">{w.word}</span>
          <ChevronDownIcon size={14} className="text-fg-2" />
        </button>
      }
    >
      <MenuLabel>Versions</MenuLabel>
      {record.versions.toReversed().map((v) => {
        const vw = stateWord('record_version', v.state);
        return (
          <MenuItem
            key={v.id}
            icon={<StateIcon kind={vw.mark} />}
            hint={shortDate(v.created_at)}
            className={v.n === shown.n ? 'bg-selected' : undefined}
            onSelect={() =>
              void navigate({
                to: '/p/$projectId/records/$code',
                params: { projectId, code: record.code },
                search: { v: v.n },
              })
            }
          >
            <span className="flex flex-col">
              <span>
                <span className="font-medium">v{v.n}</span> {vw.word}
                {v.current ? <span className="text-fg-2"> · current</span> : null}
              </span>
              <span className="text-xs text-fg-2">
                by {by(v.author)}
                {v.approved_by ? ` · approved by ${by(v.approved_by)}` : ''}
              </span>
            </span>
          </MenuItem>
        );
      })}
    </Menu>
  );
}
