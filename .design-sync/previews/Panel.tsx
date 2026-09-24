import * as React from 'react';
import { Panel, TypeIcon, CertaintyDot, StageBars, Button, StatusMark } from '@demiurgo/design-system';

export const Detail = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><Panel><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><TypeIcon type="feature" label /><CertaintyDot state="proposed" size="sm" label /><StageBars stage="not-ready" /></span><strong className="dm-text-title">Sign up for an activity</strong><span className="dm-code">FDR-INS-001 · v1</span><span className="dm-text-body" style={{ color: 'var(--ink-2)' }}>A member takes a place in one step. The same person can't take two places.</span><div style={{ display: 'flex', gap: 8 }}><Button variant="primary">Review</Button><Button>Open</Button></div></Panel></div>
);

export const FloatingPeek = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: 16 }}><Panel floating width={320}><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><TypeIcon type="feature" label /><CertaintyDot state="proposed" size="sm" label /></span><strong className="dm-text-heading">Sign up for an activity</strong><span className="dm-text-small" style={{ color: 'var(--ink-2)' }}>It rests on one assumption: members sign up for themselves only.</span><StatusMark status="conflict" count={1} label /><div style={{ display: 'flex', gap: 8 }}><Button variant="quiet">Review</Button><Button variant="text">Pin</Button><Button variant="text">Open</Button></div></Panel></div>
);
