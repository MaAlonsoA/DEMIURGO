import * as React from 'react';
import { Chip } from '@demiurgo/design-system';

export const Reasons = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: 16 }}><span style={{ fontSize: 13, fontWeight: 600 }}>Why?</span><Chip pressed>Not now</Chip><Chip>No</Chip><Chip>It's wrong</Chip></div>
);
