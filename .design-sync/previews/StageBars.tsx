import * as React from 'react';
import { StageBars } from '@demiurgo/design-system';

export const Stages = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16 }}><StageBars stage="not-ready" label /><StageBars stage="ready" label /><StageBars stage="building" label /><StageBars stage="verified" label /><StageBars stage="in-doubt" label /><StageBars stage="first-only" label /></div>
);

export const OnACard = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: 16 }}><StageBars stage="not-ready" /><StageBars stage="ready" /><StageBars stage="in-doubt" /></div>
);
