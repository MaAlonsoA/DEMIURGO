// Product views (FDR-INT-002): the map and the journeys, each read in one call.

import { queryOptions } from '@tanstack/react-query';
import { get } from './client.ts';
import type { ProductRow, Readiness } from './types.ts';

export type Relation = 'needs' | 'follows' | 'conflicts' | 'affects';

export type MapRelation = { from: string; to: string; kind: Relation; link: string; under_review: boolean };

export type MapQuestion = {
  id: string;
  exploration_id: string;
  question: string;
  state: string;
  impact: string | null;
  conclusion: string | null;
  /** Records whose thread holds the question. */
  affects: string[];
};

export type ProductMap = {
  project: { id: string; name: string; state: string };
  areas: string[];
  records: ProductRow[];
  relations: MapRelation[];
  questions: MapQuestion[];
  ideas: { id: string; purpose: string }[];
};

export type JourneyStep = { n: number; title: string; detail: string[] };

export type JourneyPath = {
  code: string;
  title: string;
  verification: string;
  given: string | null;
  when: string | null;
  outcome: string;
};

export type JourneyGap = { id: string; question: string; state: string; impact: string | null; exploration_id: string };

export type Journey = {
  code: string;
  title: string;
  version: number;
  epistemic_status: string;
  readiness: Readiness | null;
  origin_exploration: string | null;
  steps: JourneyStep[];
  paths: JourneyPath[];
  gaps: JourneyGap[];
};

export type ProductJourneys = { project: { id: string; name: string; state: string }; journeys: Journey[] };

export const mapQuery = (projectId: string) =>
  queryOptions({ queryKey: ['p', projectId, 'map'] as const, queryFn: () => get<ProductMap>(`/api/projects/${projectId}/map`) });

export const journeysQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['p', projectId, 'journeys'] as const,
    queryFn: () => get<ProductJourneys>(`/api/projects/${projectId}/journeys`),
  });
