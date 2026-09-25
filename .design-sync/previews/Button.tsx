import * as React from 'react';
import { Button } from '@demiurgo/design-system';

export const Variants = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: 16 }}><Button variant="primary">Accept</Button><Button>Change</Button><Button>Reject</Button><Button variant="quiet">Review</Button><Button variant="text">Skip for now</Button></div>
);

export const Disabled = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: 16 }}><Button variant="primary" disabled>Ratify</Button><Button disabled>Change</Button></div>
);
