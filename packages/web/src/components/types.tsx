// What a thing is, as an icon and a word (DESIGN.md §6.5): every record type — including
// requirements, quality, threat models and production readiness, which the old icon map missed —
// plus the other things of the product (checks, threads, ideas, sources…).

import type { ComponentType } from 'react';
import type { RecordType } from '../api/types.ts';
import { TYPE_WORDS } from '../words.ts';
import {
  BugIcon,
  ChecksIcon,
  CpuIcon,
  DecisionIcon,
  FeatureIcon,
  GaugeIcon,
  HelpIcon,
  IdeaIcon,
  type IconProps,
  KnowledgeIcon,
  PackageIcon,
  PlayIcon,
  RequirementIcon,
  RocketIcon,
  ShieldIcon,
  SourcesIcon,
  TagIcon,
  ThreadsIcon,
} from './icons.tsx';

export const RECORD_ICON: Record<RecordType, ComponentType<IconProps>> = {
  decision: DecisionIcon,
  fdr: FeatureIcon,
  adr: CpuIcon,
  bug: BugIcon,
  requirement: RequirementIcon,
  quality_requirement: GaugeIcon,
  threat_model: ShieldIcon,
  production_readiness: RocketIcon,
};

const OTHER_ICON: Record<string, ComponentType<IconProps>> = {
  criterion: ChecksIcon,
  check: ChecksIcon,
  thread: ThreadsIcon,
  exploration: ThreadsIcon,
  idea: IdeaIcon,
  question: HelpIcon,
  source: SourcesIcon,
  taxonomy: TagIcon,
  package: PackageIcon,
  batch: PackageIcon,
  run: PlayIcon,
  knowledge: KnowledgeIcon,
  tech: CpuIcon,
  feature: FeatureIcon,
};

/** The icon of a record type or of another kind of thing; the knowledge icon when unknown. */
export function iconOf(type: string): ComponentType<IconProps> {
  return (RECORD_ICON as Record<string, ComponentType<IconProps>>)[type] ?? OTHER_ICON[type] ?? KnowledgeIcon;
}

export function TypeIcon({ type, size = 16, className }: { type: string; size?: number; className?: string }) {
  const Icon = iconOf(type);
  return <Icon size={size} {...(className ? { className } : {})} />;
}

const PREFIX: Record<string, RecordType> = {
  DEC: 'decision',
  FDR: 'fdr',
  ADR: 'adr',
  BUG: 'bug',
  REQ: 'requirement',
  NFR: 'quality_requirement',
  THR: 'threat_model',
  PRR: 'production_readiness',
};

/** The record type a code belongs to ("NFR-EVE-002" → quality_requirement), or null. */
export function typeOfCode(code: string): RecordType | null {
  return PREFIX[code.slice(0, 3)] ?? null;
}

/** The word of a record type ("Feature", "Threat model"). */
export function typeWord(type: string): string {
  return (TYPE_WORDS as Record<string, string>)[type] ?? type;
}
