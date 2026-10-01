// Labels of the codes the forensics use: error classes (E01…E17 escape rules, build failure classes, «other:slug») and
// checklist piece ids (`agent:builder`, `piece:B07`, `escape:E09`, `guard:…`, `stage:…`, `jev:…`, `context:…`). They reuse the
// legends of the Observability screen; a code with no name is shown alone.

import { Link } from '@tanstack/react-router';
import { useMessages } from '../../i18n/define.ts';
import { Coded, PhaseLabel, RuleLabel } from '../observability/codes.tsx';
import { OBS_CODES } from '../observability/codes.i18n.ts';

export { PhaseLabel };

export function ClassLabel({ code }: { code: string }) {
  const t = useMessages(OBS_CODES);
  if (/^E\d{2}$/.test(code)) return <RuleLabel code={code} />;
  return <Coded code={code} name={t.causeName(code)} />;
}

/** «piece:B07» shows «piece:B07 Predicted files…»; the prefix tells which catalog names it. */
export function PieceIdLabel({ id }: { id: string }) {
  const t = useMessages(OBS_CODES);
  const at = id.indexOf(':');
  const kind = at < 0 ? '' : id.slice(0, at);
  const key = at < 0 ? id : id.slice(at + 1);
  if (kind === 'escape') return <RuleLabel code={key} />;
  const name = kind === 'piece' ? t.pieceName(key) : kind === 'agent' ? t.agentName(key) : '';
  return <Coded code={id} name={name} />;
}

export function TaskLink({ projectId, code }: { projectId: string; code: string }) {
  return (
    <Link to="/p/$projectId/records/$code" params={{ projectId, code }} className="font-mono text-xs text-fg hover:underline">
      {code}
    </Link>
  );
}
