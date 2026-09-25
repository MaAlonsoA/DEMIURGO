import * as React from 'react';
import { Choice } from '@demiurgo/design-system';

export const WithRecommendation = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16, width: 520 }}><Choice value="Only members" options={[{ label: 'Only members', effect: 'Others can see activities, but not sign up.', recommended: true, why: 'It matches what you said about the club.' }, { label: 'Anyone', effect: 'Sign up needs an email, and adds a Visitors list.' }]} /></div>
);

export const NothingChosen = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16, width: 520 }}><Choice options={[{ label: 'Midnight', effect: 'Activities stay listed until the day ends.', recommended: true, why: 'Members check the catalog in the evening.' }, { label: 'When it starts', effect: 'An activity leaves the list as soon as it begins.' }, { label: 'Two hours after', effect: 'Late arrivals can still find it.' }]} /></div>
);
