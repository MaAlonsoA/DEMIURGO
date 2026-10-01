// «code name»: the opaque code in small mono text and its plain name next to it, like the design phases. When no name is
// known the code is shown alone.

import { useMessages } from '../../i18n/define.ts';
import { OBS_CODES } from './codes.i18n.ts';
import { HARNESS_CONTAINMENT } from './HarnessContainment.i18n.ts';
import { HARNESS_ESCAPES } from './words.i18n.ts';

export function Coded({ code, name, title }: { code: string; name: string; title?: string }) {
  if (!name || name === code) return <span className="font-mono text-xs text-fg-2" title={title}>{code}</span>;
  return (
    <span title={title}>
      <span className="font-mono text-xs text-fg-3">{code}</span> {name}
    </span>
  );
}

export function PhaseLabel({ code }: { code: string }) {
  const t = useMessages(HARNESS_CONTAINMENT);
  return <Coded code={code} name={t.phaseName(code)} />;
}

/** «P5 Epics, features and criteria → P9 Building». */
export function PhasePath({ from, to }: { from: string; to: string }) {
  return (
    <span>
      <PhaseLabel code={from} /> → <PhaseLabel code={to} />
    </span>
  );
}

export function RuleLabel({ code }: { code: string }) {
  const t = useMessages(HARNESS_ESCAPES);
  return <Coded code={code} name={t.ruleName(code)} title={t.ruleMeaning(code) || undefined} />;
}

export function PieceLabel({ code }: { code: string }) {
  const t = useMessages(OBS_CODES);
  return <Coded code={code} name={t.pieceName(code)} />;
}

export function FindingLabel({ code }: { code: string }) {
  const t = useMessages(OBS_CODES);
  return <Coded code={code} name={t.findingName(code)} />;
}

export function CauseLabel({ code }: { code: string }) {
  const t = useMessages(OBS_CODES);
  return <Coded code={code} name={t.causeName(code)} />;
}

export function AgentLabel({ code }: { code: string }) {
  const t = useMessages(OBS_CODES);
  return <Coded code={code} name={t.agentName(code)} />;
}
