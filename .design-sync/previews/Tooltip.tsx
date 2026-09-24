import * as React from 'react';
import { Tooltip, CertaintyDot } from '@demiurgo/design-system';

export const OnAMark = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}><Tooltip>Proposed: waiting for you</Tooltip><CertaintyDot state="proposed" /></span></div>
);
