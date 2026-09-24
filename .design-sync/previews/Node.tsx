import * as React from 'react';
import { Node, StageBars, NeedsYou } from '@demiurgo/design-system';

export const States = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, width: 320 }}><Node type="feature" state="proposed" title="Sign up for an activity" trailing={<StageBars stage="not-ready" />} /><Node type="question" state="open" title="Who can sign up?" trailing={<NeedsYou count={1} />} /><Node type="idea" state="parked" title="Weather for outdoor activities" /><Node type="check" state="confirmed" selected title="Full activities say Full" /></div>
);
