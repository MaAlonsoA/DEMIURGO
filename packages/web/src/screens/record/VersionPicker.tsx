// Version selector of the record header ("v1 draft ▾"): each version with its mark, its author
// and who approved it, in a popover that floats like a peek (the design system's floating panel).

import { useNavigate } from '@tanstack/react-router';
import { DropdownMenu } from 'radix-ui';
import type { RecordDetail, RecordVersion } from '../../api/types.ts';
import { cn } from '../../lib/cn.ts';
import { shortDate } from '../../lib/time.ts';
import { buttonClass } from '../../ui/Button.tsx';
import { ChevronDown } from '../../ui/icons.tsx';
import { MarkGlyph } from '../../ui/marks.tsx';
import { WhoGlyph, whoLabel } from '../../ui/signals.tsx';
import { stateWord, whoOf } from '../../words.ts';

function By({ actor, verb }: { actor: string; verb: string }) {
  const who = whoOf(actor);
  return (
    <span className="inline-flex items-center gap-1">
      {verb}
      <WhoGlyph kind={who.kind} size={14} />
      {who.kind === 'you' ? 'you' : whoLabel(who)}
    </span>
  );
}

export function VersionPicker({ projectId, record, shown }: { projectId: string; record: RecordDetail; shown: RecordVersion }) {
  const navigate = useNavigate();
  const w = stateWord('record_version', shown.state);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={buttonClass('secondary')}
        aria-label={`Version ${shown.n} of ${record.versions.length} · choose another`}
      >
        <MarkGlyph kind={w.mark} size={9} />
        <span className="dm-text-caption font-mono">v{shown.n}</span>
        <span className="font-medium text-ink-2">{w.word.toLowerCase()}</span>
        <ChevronDown size={12} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="dm-panel dm-float z-50 min-w-72 animate-fade-in gap-0 rounded-card p-1.5"
        >
          <DropdownMenu.Label className="dm-label px-2.5 py-1.5">Versions</DropdownMenu.Label>
          {record.versions.toReversed().map((v) => {
            const vw = stateWord('record_version', v.state);
            return (
              <DropdownMenu.Item
                key={v.id}
                onSelect={() =>
                  void navigate({
                    to: '/p/$projectId/records/$code',
                    params: { projectId, code: record.code },
                    search: { v: v.n },
                  })
                }
                className={cn(
                  'dm-text-small flex cursor-pointer flex-col gap-0.5 rounded-tab px-2.5 py-2 text-ink outline-none data-[highlighted]:bg-line-soft',
                  v.n === shown.n && 'bg-surface-soft',
                )}
              >
                <span className="flex items-center gap-2">
                  <MarkGlyph kind={vw.mark} size={9} />
                  <span className="dm-text-caption font-mono font-semibold">v{v.n}</span>
                  <span className="font-medium">{vw.word}</span>
                  {v.current && <span className="text-muted">· current</span>}
                  <span className="dm-text-caption ml-auto text-muted">{shortDate(v.created_at)}</span>
                </span>
                <span className="dm-text-caption flex flex-wrap items-center gap-x-3 pl-[17px] text-muted">
                  <By actor={v.author} verb="by" />
                  {v.approved_by && <By actor={v.approved_by} verb="approved by" />}
                </span>
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
