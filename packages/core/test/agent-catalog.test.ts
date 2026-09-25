import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_AGENTS, loadAgentCatalog } from '../src/agents/catalog.ts';

const temporary: string[] = [];
afterAll(async () => {
  for (const d of temporary) await rm(d, { recursive: true, force: true });
});

async function catalogDir(agents: Record<string, string>, skills: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'demiurgo-agents-'));
  temporary.push(root);
  for (const [id, text] of Object.entries(agents)) {
    await mkdir(join(root, 'agents', id), { recursive: true });
    await writeFile(join(root, 'agents', id, 'AGENT.md'), text);
  }
  for (const [id, text] of Object.entries(skills)) {
    await mkdir(join(root, 'skills', id), { recursive: true });
    await writeFile(join(root, 'skills', id, 'SKILL.md'), text);
  }
  return root;
}

const agentText = (id: string, action: string, skills: string[]) =>
  `---\nid: ${id}\ndescription: Test agent.\naction: ${action}\nsection: Tests\nskills: [${skills.join(', ')}]\nsession: none\n---\nYou echo.\n`;
const skillText = (id: string) => `---\nname: ${id}\ndescription: A skill.\n---\nDo it well.\n`;

describe('agent catalog', () => {
  it('AC-AGE-002-04 the repository catalog loads the six agents with their skills in order and a version', async () => {
    const catalog = await loadAgentCatalog();
    expect(catalog.agents.map((a) => a.id).toSorted()).toEqual([
      'designer',
      'echo',
      'explorer',
      'knowledge_classifier',
      'knowledge_reviewer',
      'onboarding',
    ]);
    for (const a of catalog.agents) {
      expect(a.version).toMatch(/^[0-9a-f]{12}$/);
      expect(a.skillDefinitions.map((s) => s.id)).toEqual(a.skills);
      expect(a.body.length).toBeGreaterThan(40);
    }
    expect(catalog.get('onboarding')?.skills).toEqual(['asking-questions', 'demiurgo-glossary', 'structured-output']);
    expect(catalog.get('designer')?.session).toBe('thread');
    expect(catalog.get('knowledge_classifier')).toMatchObject({ action: 'knowledge_classification', session: 'none' });
  });

  it('AC-AGE-002-04 each action has a default agent that serves it', async () => {
    const catalog = await loadAgentCatalog();
    expect(DEFAULT_AGENTS).toEqual({ echo: 'echo', exploration_chat: 'explorer', design_proposal: 'designer' });
    expect(catalog.defaultFor('exploration_chat').id).toBe('explorer');
    for (const [action, id] of Object.entries(DEFAULT_AGENTS)) expect(catalog.get(id)?.action).toBe(action);
  });

  it('AC-AGE-002-04 a valid folder loads, with a default time limit of 300 s', async () => {
    const root = await catalogDir({ echo: agentText('echo', 'echo', ['plain']) }, { plain: skillText('plain') });
    const catalog = await loadAgentCatalog(root);
    expect(catalog.get('echo')).toMatchObject({ timeLimitSeconds: 300, skills: ['plain'], body: 'You echo.' });
  });

  it('AC-AGE-002-04 an agent with an unknown action or skill stops the load and names what is wrong', async () => {
    const root = await catalogDir(
      { bad: agentText('bad', 'nope', ['missing']), echo: agentText('echo', 'echo', []) },
      { plain: skillText('plain') },
    );
    await expect(loadAgentCatalog(root)).rejects.toThrow(/bad: unknown action "nope"[\s\S]*bad: unknown skill "missing"/);
  });

  it('AC-AGE-002-04 the id in the front-matter must match its folder', async () => {
    const root = await catalogDir({ echo: agentText('other', 'echo', []) }, {});
    await expect(loadAgentCatalog(root)).rejects.toThrow(/echo: the id "other" does not match its folder/);
  });
});
