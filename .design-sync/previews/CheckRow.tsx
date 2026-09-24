import * as React from 'react';
import { CheckRow } from '@demiurgo/design-system';

export const Automatic = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, width: 620 }}><CheckRow title="A member takes a place in one step" verifiedBy="automatic" statement="When a member taps Sign up on an open activity, their place is saved and they see it." code="AC-INS-001-01" /></div>
);

export const WithAWarning = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, width: 620 }}><CheckRow title="Organizers find it easy to set up" verifiedBy="you" statement="" warning='May be hard to verify: "easy". DEMIURGO suggests "in under 2 minutes".' /></div>
);
