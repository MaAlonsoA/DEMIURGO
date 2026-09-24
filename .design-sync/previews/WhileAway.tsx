import * as React from 'react';
import { WhileAway } from '@demiurgo/design-system';

export const ThreeChanges = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><WhileAway items={[{ time: 'Thu 18:52', who: 'demiurgo', text: <span>Drafted <strong>Sign up for an activity</strong>.</span> }, { time: 'Thu 19:04', who: 'demiurgo', text: <span>Stopped at a question in <strong>See who's coming</strong>.</span> }, { time: 'Thu 19:10', who: 'demiurgo', text: <span>Found that <strong>Activity catalog</strong> contradicts one of your answers.</span> }, { time: 'Since then', who: 'waited', text: 'Waited for you. Nothing was built, and nothing you confirmed was changed.' }]} /></div>
);
