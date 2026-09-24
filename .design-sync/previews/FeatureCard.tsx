import * as React from 'react';
import { FeatureCard, Signal } from '@demiurgo/design-system';

export const Confirmed = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><FeatureCard state="confirmed" stage="ready" title="Activity catalog" line="Members see every upcoming activity, with its place and time." who="you" when="Thursday" signals={<Signal kind="checks" value="0/3" />} /></div>
);

export const Proposed = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><FeatureCard state="proposed" stage="not-ready" needs={1} title="Sign up for an activity" line="A member takes a place in one step." who="demiurgo" when="18:52" signals={<Signal kind="assumptions" value={1} />} /></div>
);

export const InDoubt = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><FeatureCard state="confirmed" stage="in-doubt" needs={1} title="Activity catalog" line="Members see every upcoming activity, with its place and time." who="you" when="Thursday" signals={<Signal kind="conflict" value={1} />} /></div>
);

export const Selected = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><FeatureCard state="proposed" stage="not-ready" selected title="See who's coming" line="Organizers see who signed up for each activity." who="demiurgo" when="19:04" /></div>
);
