// Ownership of code by feature (build/ownership.ts): the pure parts.

import { describe, expect, it } from 'vitest';
import { type Owners, addOwners, createdTables, featureOfName, ownershipLine, ownershipViolations, routesOfFiles } from '../src/build/ownership.ts';

const NUTRITION = { code: 'FDR-MEA-004', title: 'Daily nutrition goals and remaining macros' };
const CARDIO = { code: 'FDR-WOR-003', title: 'Record a cardio session' };
const FEATURES = [NUTRITION, CARDIO, { code: 'FDR-MEA-001', title: 'Log a meal' }];
const none = (): Owners => ({ tables: new Map(), routes: new Map() });

const check = (over: Partial<Parameters<typeof ownershipViolations>[0]> = {}) =>
  ownershipViolations({
    taskFeature: NUTRITION,
    taskCoveredFeatures: [],
    taskText: 'Show the remaining macros for today\nGiven a goal of 2000 kcal, then the remaining ones are shown',
    addedTables: [],
    addedRoutes: [],
    owners: none(),
    featureOfName: (n) => featureOfName(n, FEATURES),
    ...over,
  });

describe('ownership by feature', () => {
  it('reads the tables a migration creates, not the ones it alters', () => {
    expect(createdTables('-- x\nCREATE TABLE IF NOT EXISTS public."cardio_sessions" (id int);\nalter table meals add column kcal int;\ncreate table goals(id int)')).toEqual(['cardio_sessions', 'goals']);
  });

  it('reads the URLs of added pages and routes', () => {
    expect(routesOfFiles(['app/meals/page.tsx', 'app/api/meals/route.ts', 'src/lib/x.ts', 'app/meals/layout.tsx'])).toEqual(['/meals', '/api/meals']);
  });

  it('the first task to add a table or a route owns it', () => {
    const owners = none();
    addOwners(owners, { feature: 'FDR-WOR-003', task: 'TSK-WOR-010', tables: ['cardio_sessions'], routes: ['/cardio'] });
    addOwners(owners, { feature: 'FDR-MEA-004', task: 'TSK-MEA-027', tables: ['cardio_sessions'], routes: [] });
    expect(owners.tables.get('cardio_sessions')).toEqual({ feature: 'FDR-WOR-003', task: 'TSK-WOR-010' });
  });

  it('matches a table name to the one feature whose title shares its words, and to none when unsure', () => {
    expect(featureOfName('cardio_sessions', FEATURES)?.feature.code).toBe('FDR-WOR-003');
    expect(featureOfName('widgets', FEATURES)).toBeNull();
    expect(featureOfName('session_log', [{ code: 'A', title: 'Session one' }, { code: 'B', title: 'Session two' }])).toBeNull();
  });

  it('the cardio_sessions case: a nutrition task creating a cardio table is a violation', () => {
    const v = check({ addedTables: ['cardio_sessions'] });
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ kind: 'table', name: 'cardio_sessions', owner: CARDIO, reason: 'name_matches_other_feature' });
    expect(ownershipLine(v[0]!)).toContain('creates cardio_sessions that belongs to FDR-WOR-003 (Record a cardio session)');
    expect(ownershipLine(v[0]!)).toContain('test double');
  });

  it('re-creating a table another feature owns is a violation, whatever the name', () => {
    const owners = none();
    addOwners(owners, { feature: 'FDR-WOR-003', task: 'TSK-WOR-010', tables: ['reps'], routes: ['/cardio'] });
    const v = check({ owners, addedTables: ['reps'], addedRoutes: ['/cardio'], featureTitles: new Map(FEATURES.map((f) => [f.code, f.title])) });
    expect(v.map((x) => `${x.kind}:${x.name}:${x.reason}:${x.owner.code}`)).toEqual(['table:reps:recreated:FDR-WOR-003', 'route:/cardio:recreated:FDR-WOR-003']);
  });

  it('is no violation when the table is the own feature\'s, a covered feature\'s or the task talks about storage', () => {
    const owners = none();
    addOwners(owners, { feature: 'FDR-MEA-004', task: 'TSK-MEA-001', tables: ['goals'], routes: [] });
    addOwners(owners, { feature: 'FDR-WOR-003', task: 'TSK-WOR-010', tables: ['reps'], routes: [] });
    expect(check({ owners, addedTables: ['goals'] })).toEqual([]);
    expect(check({ owners, addedTables: ['reps'], taskCoveredFeatures: ['FDR-WOR-003'] })).toEqual([]);
    expect(check({ addedTables: ['cardio_sessions'], taskCoveredFeatures: ['FDR-WOR-003'] })).toEqual([]);
    expect(check({ addedTables: ['cardio_sessions'], taskText: 'Store each cardio session in a table' })).toEqual([]);
  });

  it('stays quiet when unsure: an unrelated name, or a name the own feature matches as well', () => {
    expect(check({ addedTables: ['daily_targets'] })).toEqual([]);
    expect(check({ addedTables: ['nutrition_goals'] })).toEqual([]);
    expect(check({ addedTables: ['session_notes'] })).toEqual([]);
  });
});
