import * as React from 'react';
import { CertaintyDot } from '@demiurgo/design-system';

export const States = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><CertaintyDot state="confirmed" label /><CertaintyDot state="assumed" label /><CertaintyDot state="proposed" label /><CertaintyDot state="open" label /><CertaintyDot state="unknown" label /></div>
);

export const Small = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14, padding: 16 }}><CertaintyDot state="confirmed" size="sm" /><CertaintyDot state="assumed" size="sm" /><CertaintyDot state="proposed" size="sm" /><CertaintyDot state="open" size="sm" /><CertaintyDot state="unknown" size="sm" /></div>
);
