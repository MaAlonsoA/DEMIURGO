// One sober line with what a task touches (table, page, hotspot, schema change), so the person sees why
// tasks wait for each other. The source says whether it is predicted (code map, Jev) or from the merged pull request.

import type { TaskTouches } from '../../api/types.ts';
import { type Translation, useMessages } from '../../i18n/define.ts';
import { TOUCHES } from './words.i18n.ts';

type Words = Translation<typeof TOUCHES.en>;

function moduleLabel(t: Words, id: string): string {
  const i = id.indexOf(':');
  const kind = id.slice(0, i);
  const name = id.slice(i + 1);
  if (kind === 'table') return `${t.table} ${name}`;
  if (kind === 'route') return `${t.route} ${name}`;
  if (kind === 'page') return `${t.page} ${name}`;
  if (kind === 'server_action') return `${t.action} ${name.split('/').pop()}`;
  return id;
}

export function TouchesLine({ touches }: { touches: TaskTouches | null | undefined }) {
  const t = useMessages(TOUCHES);
  if (!touches) return null;
  const parts = [
    ...touches.modules.map((m) => moduleLabel(t, m)),
    ...touches.hotspots.map((h) => `${t.hotspot} ${h.split('/').pop()}`),
    ...(touches.schema ? [t.schema(touches.schema.by, touches.schema.p)] : []),
  ];
  if (parts.length === 0) return null;
  return (
    <p className="max-w-prose text-sm text-fg-2" data-touches={touches.source}>
      {t.touches} {parts.join(' · ')} <span className="text-fg-3">({touches.source === 'footprint' ? t.footprint : t.predicted})</span>
    </p>
  );
}
