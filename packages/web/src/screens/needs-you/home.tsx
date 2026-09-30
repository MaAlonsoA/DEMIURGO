// Where each thing of Needs you lives. Needs you is an index: a thing that has a home links there
// and is decided there. Only the things with no home yet (conflicts, links, classifications and
// failed updates) keep their detail in Needs you.

import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { isDefinitionProposal, proposalTargetCode } from '../../lib/attention.ts';
import type { NeedItem } from './order.ts';

export type Home =
  | { to: 'record'; code: string; version?: number }
  | { to: 'thread'; id: string }
  | { to: 'batch'; id: string }
  | { to: 'product' };

export type Homed = Exclude<NeedItem['kind'], 'conflict' | 'link' | 'classification' | 'update'>;

/** The page a thing is decided on, or null when it is still decided here. */
export function homeOf(item: NeedItem): Home | null {
  switch (item.kind) {
    case 'question':
      return { to: 'thread', id: item.question.exploration_id };
    case 'version':
      return { to: 'record', code: item.version.code, version: item.version.n };
    case 'package':
      return item.batch.proposals.length > 0 && item.batch.proposals.every(isDefinitionProposal)
        ? { to: 'product' }
        : { to: 'batch', id: item.batch.id };
    case 'proposal': {
      if (isDefinitionProposal(item.proposal)) return { to: 'product' };
      const code = proposalTargetCode(item.proposal);
      return code ? { to: 'record', code } : { to: 'batch', id: item.batch.id };
    }
    default:
      return null;
  }
}

export function HomeLink({
  projectId,
  home,
  className,
  children,
  ...rest
}: {
  projectId: string;
  home: Home;
  className?: string;
  children: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  switch (home.to) {
    case 'record':
      return (
        <Link
          to="/p/$projectId/records/$code"
          params={{ projectId, code: home.code }}
          {...(home.version !== undefined ? { search: { v: home.version } } : {})}
          className={className}
          {...rest}
        >
          {children}
        </Link>
      );
    case 'thread':
      return (
        <Link to="/p/$projectId/threads/$explorationId" params={{ projectId, explorationId: home.id }} className={className} {...rest}>
          {children}
        </Link>
      );
    case 'product':
      return (
        <Link to="/p/$projectId" params={{ projectId }} hash="definition" className={className} {...rest}>
          {children}
        </Link>
      );
    case 'batch':
      return (
        <Link to="/p/$projectId/batches/$batchId" params={{ projectId, batchId: home.id }} className={className} {...rest}>
          {children}
        </Link>
      );
  }
}
