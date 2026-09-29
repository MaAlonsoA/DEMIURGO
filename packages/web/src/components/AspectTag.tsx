// The aspect of a proposal or a record as a quiet tag ("Quality"), next to its one noun
// ("Proposal", "Record"). Nothing for a thing without an aspect.

import { type Aspect, aspectOfProposal } from '../aspects.ts';
import { ASPECT_WORDS, NOUNS, proposalNoun } from '../aspects.i18n.ts';
import { useMessages } from '../i18n/define.ts';
import { Tag } from './Badge.tsx';

export function AspectTag({ aspect, className }: { aspect: Aspect | null | undefined; className?: string }) {
  const w = useMessages(ASPECT_WORDS);
  if (!aspect) return null;
  return <Tag className={className}>{w[aspect]}</Tag>;
}

/** "Proposal [Quality]": a proposal's noun and its aspect. */
export function ProposalKind({
  proposal,
  className,
}: {
  proposal: { type: string; payload: Record<string, unknown> };
  className?: string;
}) {
  const w = useMessages(NOUNS);
  return (
    <span className={className ?? 'inline-flex items-center gap-1.5'}>
      <span>{proposalNoun(proposal.type, w)}</span>
      <AspectTag aspect={aspectOfProposal(proposal)} />
    </span>
  );
}

/** "Record [Architecture]", or "Accepted proposal [Architecture]" while its version is a draft. */
export function RecordKind({
  aspect,
  draft,
  className,
}: {
  aspect: Aspect | null | undefined;
  draft?: boolean;
  className?: string;
}) {
  const w = useMessages(NOUNS);
  return (
    <span className={className ?? 'inline-flex items-center gap-1.5'}>
      <span>{draft ? w.acceptedProposal : w.record}</span>
      <AspectTag aspect={aspect} />
    </span>
  );
}
