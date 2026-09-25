// The knowledge search: the same words in English or in Spanish, with their plurals and forms, and
// the ideas and threads of the project (their purpose), not only records and checks.

import { human } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { searchKnowledge } from '../src/knowledge/graph-pg.ts';
import { useEnvironment } from './support/env.ts';

const ana = human('ana');
const environment = useEnvironment();

async function approvedDecision(projectId: string, title: string, decision: string) {
  const s = environment().services;
  const r = await executeCommand(s, {
    command: 'record.create',
    actor: ana,
    projectId,
    data: {
      type: 'decision',
      domain: 'club',
      title,
      sections: [
        { title: 'Context', content: 'Why it came up.' },
        { title: 'Decision', content: decision },
        { title: 'Consequences', content: 'What follows.' },
      ],
    },
  });
  const versionId = (r.result as { versionId: string }).versionId;
  await executeCommand(s, { command: 'record_version.approve', actor: ana, projectId, entityId: versionId, data: {} });
}

describe('searching the knowledge', () => {
  it('finds English and Spanish words in their other forms, and ideas and threads by their purpose', async () => {
    const s = environment().services;
    const { projectId } = await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Search' } });
    await approvedDecision(projectId, 'Members sign up for activities', 'Organizers publish trips.');
    await approvedDecision(projectId, 'Los socios se inscriben', 'Las inscripciones abren el lunes.');
    const idea = (
      await executeCommand(s, {
        command: 'exploration.open',
        actor: ana,
        projectId,
        data: { purpose: 'Parking spots for visitors' },
      })
    ).entityId;
    await executeCommand(s, {
      command: 'exploration.set_aside',
      actor: ana,
      projectId,
      entityId: idea,
      data: { reason: 'Later.' },
    });
    const thread = (
      await executeCommand(s, {
        command: 'exploration.open',
        actor: ana,
        projectId,
        data: { purpose: 'How organizers publish trips' },
      })
    ).entityId;

    const titles = async (q: string) => (await searchKnowledge(s.db, projectId, q)).map((r) => r.title);
    expect(await titles('activity')).toContain('Members sign up for activities');
    expect(await titles('member')).toContain('Members sign up for activities');
    expect(await titles('socio')).toContain('Los socios se inscriben');
    expect(await titles('inscripción')).toContain('Los socios se inscriben');

    const parked = await searchKnowledge(s.db, projectId, 'parking visitor');
    expect(parked).toContainEqual(
      expect.objectContaining({ ref: `exploration:${idea}`, type: 'idea', title: 'Parking spots for visitors' }),
    );
    const threads = await searchKnowledge(s.db, projectId, 'organizer');
    expect(threads).toContainEqual(expect.objectContaining({ ref: `exploration:${thread}`, type: 'thread' }));
  });
});
