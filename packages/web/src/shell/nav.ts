// The sections of a project, in the order the sidebar shows them (DESIGN.md §2.1): what asks for
// action first, then the product, then knowledge, then settings. Each section owns the routes that
// light it up in the sidebar.

import type { ComponentType } from 'react';
import {
  ActivityIcon,
  CpuIcon,
  InboxIcon,
  type IconProps,
  KeyIcon,
  KnowledgeIcon,
  ProductIcon,
  SourcesIcon,
  ThreadsIcon,
} from '../components/icons.tsx';

export type NavKey = 'needs' | 'threads' | 'product' | 'activity' | 'knowledge' | 'sources' | 'models' | 'keys';

export type NavItem = {
  key: NavKey;
  label: string;
  to: string;
  icon: ComponentType<IconProps>;
  group: 'work' | 'knowledge' | 'settings';
  /** The paths (after /p/:id) this section owns. */
  match: RegExp;
};

export const NAV: NavItem[] = [
  {
    key: 'needs',
    label: 'Needs you',
    to: '/p/$projectId/needs-you',
    icon: InboxIcon,
    group: 'work',
    match: /^\/(needs-you|batches)(\/|$)/,
  },
  {
    key: 'threads',
    label: 'Threads',
    to: '/p/$projectId/threads',
    icon: ThreadsIcon,
    group: 'work',
    match: /^\/(threads|start)(\/|$)/,
  },
  {
    key: 'product',
    label: 'Product',
    to: '/p/$projectId',
    icon: ProductIcon,
    group: 'work',
    match: /^(\/?$|\/(map|journeys|origins|records)(\/|$))/,
  },
  {
    key: 'activity',
    label: 'Activity',
    to: '/p/$projectId/activity',
    icon: ActivityIcon,
    group: 'work',
    match: /^\/(activity|runs)(\/|$)/,
  },
  {
    key: 'knowledge',
    label: 'Knowledge',
    to: '/p/$projectId/knowledge',
    icon: KnowledgeIcon,
    group: 'knowledge',
    match: /^\/knowledge(\/|$)/,
  },
  {
    key: 'sources',
    label: 'Sources',
    to: '/p/$projectId/sources',
    icon: SourcesIcon,
    group: 'knowledge',
    match: /^\/sources(\/|$)/,
  },
  {
    key: 'models',
    label: 'Models & providers',
    to: '/p/$projectId/models',
    icon: CpuIcon,
    group: 'settings',
    match: /^\/models(\/|$)/,
  },
  {
    key: 'keys',
    label: 'Agent keys',
    to: '/p/$projectId/agent-keys',
    icon: KeyIcon,
    group: 'settings',
    match: /^\/agent-keys(\/|$)/,
  },
];

/** The section a pathname belongs to ("/p/abc/runs/1" → activity). */
export function sectionOf(pathname: string): NavKey | null {
  const rest = pathname.replace(/^\/p\/[^/]+/, '');
  return NAV.find((n) => n.match.test(rest))?.key ?? null;
}
