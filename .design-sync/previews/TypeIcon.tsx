import * as React from 'react';
import { TypeIcon } from '@demiurgo/design-system';

export const Types = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}><TypeIcon type="feature" label /><TypeIcon type="decision" label /><TypeIcon type="tech-decision" label /><TypeIcon type="question" label /><TypeIcon type="check" label /><TypeIcon type="idea" label /><TypeIcon type="thread" label /><TypeIcon type="journey" label /></div>
);

export const Icons = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 18, padding: 16 }}><TypeIcon type="feature" size={20} /><TypeIcon type="decision" size={20} /><TypeIcon type="tech-decision" size={20} /><TypeIcon type="question" size={20} /><TypeIcon type="check" size={20} /><TypeIcon type="idea" size={20} /><TypeIcon type="thread" size={20} /><TypeIcon type="journey" size={20} /></div>
);
