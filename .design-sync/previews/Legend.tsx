import * as React from 'react';
import { Legend, StatusMark, StageBars, CertaintyDot, NeedsYou } from '@demiurgo/design-system';

export const Open = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><Legend open newMarks={[{ mark: <StatusMark status="conflict" count={1} />, word: 'Conflict', desc: "Two things you confirmed clash. DEMIURGO won't pick for you." }, { mark: <StageBars stage="in-doubt" />, word: 'In doubt', desc: 'It was ready to build; something holds it back.' }]} known={[{ mark: <CertaintyDot state="confirmed" size="sm" />, word: 'Confirmed' }, { mark: <CertaintyDot state="proposed" size="sm" />, word: 'Proposed' }, { mark: <NeedsYou count={1} />, word: 'Needs you' }, { mark: <StageBars stage="ready" />, word: 'Ready to build' }]} /></div>
);

export const Folded = () => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20, padding: 16 }}><Legend open={false} newMarks={[{ mark: <StatusMark status="conflict" count={1} />, word: 'Conflict' }, { mark: <StageBars stage="in-doubt" />, word: 'In doubt' }]} /></div>
);
