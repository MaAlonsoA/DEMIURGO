// The sections of a record (canvas B2): Overview, Questions, Checks and History, in ?tab=. The
// version shown (?v=) is kept when moving between them.

export const RECORD_TABS = ['overview', 'questions', 'checks', 'history'] as const;
export type RecordTab = (typeof RECORD_TABS)[number];

export function tabOf(value: unknown): RecordTab {
  return RECORD_TABS.find((t) => t === value) ?? 'overview';
}

/** The search of a record's URL for a tab: Overview is the default and is not written. */
export function tabSearch(v: number | undefined, tab: RecordTab): { v?: number; tab?: RecordTab } {
  return { ...(v === undefined ? {} : { v }), ...(tab === 'overview' ? {} : { tab }) };
}
