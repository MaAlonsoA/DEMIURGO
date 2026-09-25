import * as React from 'react';
import { Icon } from '@demiurgo/design-system';

export const Signals = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><Icon name="depends-on" size={20} stroke={2} /><Icon name="conflict" size={20} stroke={2} /><Icon name="needs-review" size={20} stroke={2} /><Icon name="blocked" size={20} stroke={2} /><Icon name="clock" size={20} stroke={2} /></div>
);

export const Types = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><Icon name="feature" size={20} /><Icon name="decision" size={20} /><Icon name="tech-decision" size={20} /><Icon name="bug" size={20} /></div>
);
