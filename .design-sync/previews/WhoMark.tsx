import * as React from 'react';
import { WhoMark } from '@demiurgo/design-system';

export const Everyone = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><WhoMark who="you" size={22} label /><WhoMark who="demiurgo" size={22} label /><WhoMark who="agent" size={22} label /><WhoMark who="automatic" size={22} label /></div>
);

export const WithNames = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><WhoMark who="demiurgo" name="Sonnet 5" size={22} label /><WhoMark who="agent" name="Claude Code" size={22} label /></div>
);
