// The bus as a point of emission (observability spec §5.1, §5.2, §6.1, §6.3, §7.3): one
// `command <name>` span per command, hanging from the interaction or from the command that nests
// it; the journal's correlation is the interaction id; the `demiurgo.journal` note carries what the
// event carries; creations leave their trace context; a failed transaction names the spans that
// closed as `ok` inside it.

import { ATTR, DomainError, LOG, SPAN, human, interactionIdOf, parseTraceParent } from '@demiurgo/domain';
import { SpanStatusCode } from '@opentelemetry/api';
import { beforeEach, describe, expect, it } from 'vitest';
import { executeCommand, inTransaction } from '../src/bus/bus.ts';
import { noopObserver } from '../src/observe/noop.ts';
import type { InteractionRoot } from '../src/observe/observer.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment();
const ana = human('ana');
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RE_SHA256 = /^[0-9a-f]{64}$/;

const root = (command: string): InteractionRoot => ({ channel: 'api', actor: 'human:ana', actorType: 'human', command });

const spansNamed = (name: string) =>
  environment()
    .observer.spans()
    .filter((s) => s.name === name);
const logsNamed = (name: string) =>
  environment()
    .observer.logs()
    .filter((l) => l.eventName === name);

async function events(projectId: string) {
  return environment().services.db.selectFrom('events').selectAll().where('project_id', '=', projectId).orderBy('seq').execute();
}

async function traceContexts(projectId: string) {
  return environment()
    .services.db.selectFrom('trace_contexts')
    .selectAll()
    .where('project_id', '=', projectId)
    .orderBy('created_at')
    .execute();
}

async function createProject(name: string): Promise<string> {
  const r = await executeCommand(environment().services, { command: 'project.create', actor: ana, data: { name } });
  return r.projectId;
}

beforeEach(() => environment().observer.reset());

describe('the bus inside an interaction', () => {
  it('opens a command span under the interaction, correlates the event with it and notes the journal', async () => {
    const s = environment().services;
    const { r, id } = await s.observer.interaction(root('project.create'), async (ctx) => ({
      r: await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Traced' } }),
      id: ctx.id,
    }));

    const [interaction] = spansNamed(`${SPAN.interaction} project.create`);
    const [command] = spansNamed(`${SPAN.command} project.create`);
    expect(interaction?.parentSpanContext).toBeUndefined();
    expect(command?.parentSpanContext?.spanId).toBe(interaction?.spanContext().spanId);
    expect(command?.spanContext().traceId).toBe(interaction?.spanContext().traceId);
    expect(interactionIdOf(command?.spanContext().traceId ?? '')).toBe(id);
    expect(command?.status.code).toBe(SpanStatusCode.OK);
    expect(command?.attributes).toMatchObject({
      [ATTR.command]: 'project.create',
      [ATTR.actor]: 'human:ana',
      [ATTR.actorType]: 'human',
      [ATTR.projectId]: r.projectId,
      [ATTR.entityType]: 'project',
      [ATTR.entityId]: r.projectId,
      [ATTR.stateAfter]: 'active',
      [ATTR.eventSeq]: 1,
      [ATTR.outcome]: 'ok',
    });
    expect(command?.attributes[ATTR.stateBefore]).toBeUndefined();
    expect(command?.attributes[ATTR.eventNone]).toBeUndefined();
    expect(command?.attributes[ATTR.payloadAfterHash]).toMatch(RE_SHA256);

    const [event] = await events(r.projectId);
    expect(event?.cause).toMatchObject({ correlation: id });

    const [journal] = logsNamed(LOG.journal);
    expect(logsNamed(LOG.journal)).toHaveLength(1);
    expect(journal?.spanContext?.traceId).toBe(interaction?.spanContext().traceId);
    expect(journal?.spanContext?.spanId).toBe(command?.spanContext().spanId);
    expect(journal?.attributes).toMatchObject({
      [ATTR.eventSeq]: 1,
      [ATTR.command]: 'project.create',
      [ATTR.entityType]: 'project',
      [ATTR.entityId]: r.projectId,
      [ATTR.projectId]: r.projectId,
    });
    const body = JSON.parse(typeof journal?.body === 'string' ? journal.body : '') as { before: unknown; after: unknown };
    expect(body.before).toBeNull();
    expect(body.after).toEqual(event?.after);
  });

  it('a nested command hangs from the command that nests it and shares its correlation', async () => {
    const s = environment().services;
    const projectId = await createProject('Nested');
    environment().observer.reset();
    const { id } = await s.observer.interaction(root('run.request'), async (ctx) => ({
      r: await executeCommand(s, {
        command: 'run.request',
        actor: ana,
        projectId,
        data: { action: 'echo', scope: { type: 'project' }, input: { text: 'hi' } },
      }),
      id: ctx.id,
    }));

    const [outer] = spansNamed(`${SPAN.command} run.request`);
    const [inner] = spansNamed(`${SPAN.command} context_pack.build`);
    expect(inner?.parentSpanContext?.spanId).toBe(outer?.spanContext().spanId);
    expect(inner?.spanContext().traceId).toBe(outer?.spanContext().traceId);
    expect(inner?.attributes).toMatchObject({
      [ATTR.entityType]: 'context_pack',
      [ATTR.outcome]: 'ok',
      [ATTR.projectId]: projectId,
    });

    const ev = (await events(projectId)).filter((e) => e.command !== 'project.create');
    expect(ev.map((e) => e.command)).toEqual(expect.arrayContaining(['context_pack.build', 'run.request']));
    const correlations = new Set(ev.map((e) => (e.cause as { correlation: string }).correlation));
    expect(correlations).toEqual(new Set([id]));
  });

  it('a guard failure and a transition failure leave their outcome, no journal note and no trace context', async () => {
    const s = environment().services;
    const projectId = await createProject('Failures');
    const exploration = await executeCommand(s, {
      command: 'exploration.open',
      actor: ana,
      projectId,
      data: { purpose: 'Fail on purpose' },
    });
    const contextsBefore = await traceContexts(projectId);
    environment().observer.reset();

    await expect(
      s.observer.interaction(root('exploration.set_aside'), () =>
        executeCommand(s, { command: 'exploration.set_aside', actor: ana, projectId, entityId: exploration.entityId, data: {} }),
      ),
    ).rejects.toMatchObject({ type: 'guard' });
    const [guarded] = spansNamed(`${SPAN.command} exploration.set_aside`);
    expect(guarded?.status.code).toBe(SpanStatusCode.ERROR);
    expect(guarded?.attributes).toMatchObject({
      [ATTR.outcome]: 'guard',
      [ATTR.reasons]: ['A reason is required.'],
      [ATTR.errorType]: 'guard',
      [ATTR.entityType]: 'exploration',
      [ATTR.entityId]: exploration.entityId,
    });
    expect(guarded?.attributes[ATTR.eventSeq]).toBeUndefined();

    await executeCommand(s, { command: 'project.archive', actor: ana, projectId, entityId: projectId, data: {} });
    await expect(
      s.observer.interaction(root('project.archive'), () =>
        executeCommand(s, { command: 'project.archive', actor: ana, projectId, entityId: projectId, data: {} }),
      ),
    ).rejects.toMatchObject({ type: 'invalid_transition' });
    const archives = spansNamed(`${SPAN.command} project.archive`);
    expect(archives.map((a) => a.attributes[ATTR.outcome])).toEqual(['ok', 'invalid_transition']);
    expect(archives[1]?.status.code).toBe(SpanStatusCode.ERROR);
    expect(archives[1]?.attributes[ATTR.reasons]).toBeUndefined();

    expect(logsNamed(LOG.journal).map((l) => l.attributes[ATTR.command])).toEqual(['project.archive']);
    expect(await traceContexts(projectId)).toEqual(contextsBefore);
  });

  it('a creation leaves one trace context tied to its command span; a non-creation leaves none', async () => {
    const s = environment().services;
    const { r } = await s.observer.interaction(root('project.create'), async () => ({
      r: await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Contexts' } }),
    }));
    const [command] = spansNamed(`${SPAN.command} project.create`);
    const rows = await traceContexts(r.projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity_type: 'project', entity_id: r.projectId, project_id: r.projectId });
    expect(parseTraceParent(rows[0]?.trace_parent ?? '')).toEqual({
      traceId: command?.spanContext().traceId,
      spanId: command?.spanContext().spanId,
      flags: '01',
    });

    await s.observer.interaction(root('project.archive'), () =>
      executeCommand(s, { command: 'project.archive', actor: ana, projectId: r.projectId, entityId: r.projectId, data: {} }),
    );
    expect(await traceContexts(r.projectId)).toHaveLength(1);
  });

  it('inTransaction shares one correlation, the interaction id, across its commands', async () => {
    const s = environment().services;
    const projectId = await createProject('Shared');
    const id = await s.observer.interaction(root('exploration.open'), async (ctx) => {
      await inTransaction(s, async (execute) => {
        await execute({ command: 'exploration.open', actor: ana, projectId, data: { purpose: 'First' } });
        await execute({ command: 'exploration.open', actor: ana, projectId, data: { purpose: 'Second' } });
      });
      return ctx.id;
    });
    const ev = (await events(projectId)).filter((e) => e.command === 'exploration.open');
    expect(ev).toHaveLength(2);
    for (const e of ev) expect(e.cause).toMatchObject({ correlation: id });
    const spans = spansNamed(`${SPAN.command} exploration.open`);
    expect(spans).toHaveLength(2);
    const [interaction] = spansNamed(`${SPAN.interaction} exploration.open`);
    for (const c of spans) expect(c.parentSpanContext?.spanId).toBe(interaction?.spanContext().spanId);
  });

  it('a failed transaction notes the rollback with the spans that had closed as ok, and the journal keeps nothing', async () => {
    const s = environment().services;
    const projectId = await createProject('Rollback');
    const before = await events(projectId);
    environment().observer.reset();
    await expect(
      s.observer.interaction(root('project.archive'), () =>
        inTransaction(s, async (execute) => {
          await execute({ command: 'project.archive', actor: ana, projectId, entityId: projectId, data: {} });
          await execute({ command: 'project.archive', actor: ana, projectId, entityId: projectId, data: {} });
        }),
      ),
    ).rejects.toBeInstanceOf(DomainError);

    const [first, second] = spansNamed(`${SPAN.command} project.archive`);
    expect(first?.attributes[ATTR.outcome]).toBe('ok');
    expect(second?.attributes[ATTR.outcome]).toBe('invalid_transition');
    const [rollback] = logsNamed(LOG.transactionRollback);
    expect(logsNamed(LOG.transactionRollback)).toHaveLength(1);
    expect(rollback?.attributes).toMatchObject({
      [ATTR.rollbackSpans]: [first?.spanContext().spanId],
      [ATTR.errorType]: 'invalid_transition',
    });
    expect(rollback?.spanContext?.traceId).toBe(first?.spanContext().traceId);
    // The journal note was emitted inside the transaction: the rollback note is what discards it.
    expect(logsNamed(LOG.journal)).toHaveLength(1);
    expect(await events(projectId)).toEqual(before);
    expect(await traceContexts(projectId)).toHaveLength(1);
  });
});

describe('the bus outside an interaction', () => {
  it('still correlates with a UUID and opens the command span as a root', async () => {
    const s = environment().services;
    const r = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Alone' } });
    const [command] = spansNamed(`${SPAN.command} project.create`);
    expect(command?.parentSpanContext).toBeUndefined();
    expect(spansNamed(`${SPAN.interaction} project.create`)).toHaveLength(0);
    const [event] = await events(r.projectId);
    expect(event?.cause).toMatchObject({ correlation: expect.stringMatching(RE_UUID) as unknown });
    expect(await traceContexts(r.projectId)).toHaveLength(1);
  });
});

describe('with observation off', () => {
  it('emits nothing and writes no trace context, but the correlation is still the interaction id', async () => {
    const s = { ...environment().services, observer: noopObserver };
    const { r, id } = await noopObserver.interaction(root('project.create'), async (ctx) => ({
      r: await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Silent' } }),
      id: ctx.id,
    }));
    const alone = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Silent too' } });
    expect(environment().observer.spans()).toHaveLength(0);
    expect(environment().observer.logs()).toHaveLength(0);
    expect(await traceContexts(r.projectId)).toHaveLength(0);
    expect(await traceContexts(alone.projectId)).toHaveLength(0);
    const [event] = await events(r.projectId);
    expect(event?.cause).toMatchObject({ correlation: id });
  });
});
