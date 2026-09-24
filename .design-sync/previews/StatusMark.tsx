import * as React from 'react';
import { StatusMark } from '@demiurgo/design-system';

export const Statuses = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><StatusMark status="parked" label /><StatusMark status="dropped" label /><StatusMark status="replaced" label /><StatusMark status="out-of-date" label /><StatusMark status="conflict" count={1} label /></div>
);

export const Conflict = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><StatusMark status="conflict" count={2} /><StatusMark status="conflict" count={1} label /></div>
);
