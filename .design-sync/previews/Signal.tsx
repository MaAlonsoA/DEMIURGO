import * as React from 'react';
import { Signal } from '@demiurgo/design-system';

export const AllSignals = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: 16 }}><Signal kind="checks" value="2/3" /><Signal kind="depends-on" value={2} /><Signal kind="assumptions" value={1} /><Signal kind="changed" value="v2" /></div>
);

export const Problems = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: 16 }}><Signal kind="conflict" value={1} /><Signal kind="needs-review" /><Signal kind="blocked" /></div>
);
