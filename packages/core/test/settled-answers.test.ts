// A design-system thread receives what the person confirmed in other threads («Help me choose»).

import { human } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { settledAnswersOf } from '../src/actions/exploration-chat.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment({});
const ana = human('ana');
let projectId = '';
const db = () => environment().services.db;

beforeAll(async () => {
  projectId = (await executeCommand(environment().services, { command: 'project.create', actor: ana, data: { name: 'Settled' } })).projectId;
});

describe('settledAnswersOf', () => {
  it('returns the confirmed answers of the other threads, not the thread itself nor open questions', async () => {
    const open = (purpose: string) => executeCommand(environment().services, { command: 'exploration.open', actor: ana, projectId, data: { purpose } });
    const choose = (await open('Help me choose a design system')).entityId;
    const design = (await open('Design system: start from Carbon')).entityId;
    const q = (exploration_id: string, question: string, state: string, conclusion: string | null) =>
      db()
        .insertInto('questions')
        .values({ project_id: projectId, exploration_id, question, state, conclusion, raised_by: 'agent:test:1', impact: 'medium' })
        .execute();
    await q(choose, 'What personality should it convey?', 'confirmed', 'Calm and precise');
    await q(choose, 'Motion?', 'pending', null);
    await q(design, 'Density?', 'confirmed', 'Compact');
    expect(await settledAnswersOf(db(), projectId, design)).toEqual([{ question: 'What personality should it convey?', answer: 'Calm and precise' }]);
  });
});
