import { composeSystem, jsonSchemaOf } from '@demiurgo/domain';
import { describe, expect, it } from 'vitest';
import { loadAgentCatalog } from '../src/agents/catalog.ts';

// Records are always in English; only `reply` follows the person's language.
describe('record language in the agents', () => {
  it('every agent that writes records is told to write them in English and to reply in the person language', async () => {
    const catalog = await loadAgentCatalog();
    const writers = catalog.agents.filter((a) => a.action === 'exploration_chat' || a.action === 'design_proposal');
    expect(writers.map((a) => a.id).toSorted()).toEqual(['designer', 'explainer', 'explorer', 'onboarding']);
    for (const agent of writers) {
      const { system } = composeSystem(agent, agent.skillDefinitions, []);
      expect(`${agent.id}: ${system}`).toContain('is always written in English');
      expect(`${agent.id}: ${system}`).toContain("`reply` is the only field written in the person's language");
      expect(`${agent.id}: ${system}`).not.toContain("in the person's language.\n- `observations`");
    }
  });

  it('the output schemas mark every record field as English and leave reply free', () => {
    const chat = jsonSchemaOf('exploration_chat') as { properties: Record<string, { description?: string }> };
    expect(chat.properties.reply?.description).toBeUndefined();
    const text = JSON.stringify(chat);
    expect(text.match(/"description":"In English\."/g)?.length).toBeGreaterThanOrEqual(20);
    const fdr = JSON.stringify(jsonSchemaOf('design_proposal'));
    for (const field of ['title', 'goal', 'scope', 'out_of_scope', 'behavior', 'statement', 'check']) {
      expect(fdr).toMatch(new RegExp(`"${field}":\\{[^}]*"description":"In English\\."`));
    }
  });

  it('the glossary gives the fixed English term for the Spanish product words', async () => {
    const glossary = (await loadAgentCatalog()).get('designer')?.skillDefinitions.find((s) => s.id === 'demiurgo-glossary');
    expect(glossary?.body).toContain('| criterio de aceptación | acceptance criterion |');
  });
});
