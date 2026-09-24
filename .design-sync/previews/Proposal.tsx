import * as React from 'react';
import { Proposal } from '@demiurgo/design-system';

export const FromAnAgent = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><Proposal author="agent" authorName="Claude Code" position="1 of 4" type="check" kindLabel="New check" title='Full activities say "Full"' why="Members kept tapping full activities. Saying Full up front saves a step." source="clubactivities.org/agenda" /></div>
);

export const WithANote = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><Proposal author="agent" authorName="Claude Code" position="3 of 4" type="feature" kindLabel="New step" title="Show the weather for outdoor activities" why="Outdoor plans change with the weather; members asked for it." note="This grows Activity catalog beyond your idea: nothing you said mentions the weather." /></div>
);

export const OutOfDate = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><Proposal author="agent" authorName="Claude Code" type="check" kindLabel="Change" title="Show 20 at a time" why="" outOfDate="You changed check 1 after it was written. Ask Claude Code to redo it." /></div>
);
