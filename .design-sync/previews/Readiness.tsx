import * as React from 'react';
import { Readiness } from '@demiurgo/design-system';

export const NotReady = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><Readiness items={[{ text: 'The version is not approved yet.', state: 'proposed' }, { text: '1 question is still open in its thread.' }, { text: '1 answer DEMIURGO assumed is waiting for you.', kind: 'assumed' }, { text: 'Check 2 may be hard to verify: "easy to find".', kind: 'warning' }]} /></div>
);

export const Ready = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><Readiness next="Next: Sign up for an activity needs you." /></div>
);
