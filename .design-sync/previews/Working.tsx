import * as React from 'react';
import { Working, Button } from '@demiurgo/design-system';

export const Drafting = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><Working>Drafting Sign up for an activity… · 0:42</Working></div>
);

export const WithCancel = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '8px 12px' }}><Working>DEMIURGO is working · 1m 12s</Working><Button variant="text">Cancel</Button></div></div>
);
