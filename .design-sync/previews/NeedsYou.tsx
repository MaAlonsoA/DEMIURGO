import * as React from 'react';
import { NeedsYou } from '@demiurgo/design-system';

export const InTheHeader = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><NeedsYou count={3} label /></div>
);

export const Counters = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14, padding: 16 }}><NeedsYou count={1} /><NeedsYou count={12} /></div>
);
