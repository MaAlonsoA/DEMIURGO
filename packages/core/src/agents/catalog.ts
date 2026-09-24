// DEMIURGO agents and skills as files of the repository (FDR-AGE-002): each agent is
// `agents/<id>/AGENT.md` (YAML front-matter + instructions) and each skill `skills/<id>/SKILL.md`.
// The catalog is loaded once and validated whole: an agent with an unknown action or skill stops
// the load. An agent's version is the fingerprint of its content and its skills.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENT_ACTIONS,
  type AgentAction,
  type AgentDefinition,
  type SkillDefinition,
  agentVersion,
  fingerprint,
  jsonSchemaOf,
} from '@demiurgo/domain';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/** Action of the knowledge classifier's agents: they don't produce an agent run. */
export const CLASSIFICATION_ACTION = 'knowledge_classification';

/** Default agent of each action, when the web section doesn't name one. */
export const DEFAULT_AGENTS: Readonly<Record<AgentAction, string>> = {
  echo: 'echo',
  exploration_chat: 'explorer',
  design_proposal: 'designer',
};

export type LoadedAgent = AgentDefinition & { version: string; skillDefinitions: readonly SkillDefinition[] };

export type AgentCatalog = {
  agents: readonly LoadedAgent[];
  skills: readonly SkillDefinition[];
  get(id: string): LoadedAgent | undefined;
  defaultFor(action: AgentAction): LoadedAgent;
};

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const agentFront = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    description: z.string().min(1),
    action: z.string().min(1),
    section: z.string().min(1),
    skills: z.array(z.string().min(1)).default([]),
    session: z.enum(['thread', 'none']),
    time_limit: z.number().int().min(10).max(1800).default(300),
  })
  .strict();

const skillFront = z.object({ name: z.string().min(1), description: z.string().min(1) }).strict();

/** Splits a markdown file into its YAML front-matter and its body. */
function splitFrontMatter(text: string): { front: unknown; body: string } | null {
  const clean = text.replaceAll('\r\n', '\n');
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(clean);
  if (!m) return null;
  return { front: parseYaml(m[1] ?? ''), body: (m[2] ?? '').trim() };
}

async function folders(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .toSorted();
  } catch {
    return [];
  }
}

async function load(root: string): Promise<AgentCatalog> {
  const problems: string[] = [];
  const skills = new Map<string, SkillDefinition>();
  for (const id of await folders(join(root, 'skills'))) {
    const parts = splitFrontMatter(await readFile(join(root, 'skills', id, 'SKILL.md'), 'utf8').catch(() => ''));
    const front = skillFront.safeParse(parts?.front);
    if (!parts || !front.success) {
      problems.push(`skill ${id}: SKILL.md needs a front-matter with name and description.`);
      continue;
    }
    if (front.data.name !== id) problems.push(`skill ${id}: the name "${front.data.name}" does not match its folder.`);
    skills.set(id, { id, description: front.data.description, body: parts.body });
  }
  const actions = new Set<string>([...AGENT_ACTIONS, CLASSIFICATION_ACTION]);
  const agents: LoadedAgent[] = [];
  for (const id of await folders(join(root, 'agents'))) {
    const parts = splitFrontMatter(await readFile(join(root, 'agents', id, 'AGENT.md'), 'utf8').catch(() => ''));
    const front = agentFront.safeParse(parts?.front);
    if (!parts || !front.success) {
      const detail = front.success ? '' : ` ${front.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
      problems.push(`${id}: AGENT.md has no valid front-matter.${detail}`);
      continue;
    }
    const f = front.data;
    if (f.id !== id) problems.push(`${id}: the id "${f.id}" does not match its folder.`);
    if (!actions.has(f.action)) problems.push(`${id}: unknown action "${f.action}".`);
    const missing = f.skills.filter((s) => !skills.has(s));
    for (const s of missing) problems.push(`${id}: unknown skill "${s}".`);
    if (!parts.body) problems.push(`${id}: AGENT.md has no instructions.`);
    if (missing.length > 0) continue;
    const definition: AgentDefinition = {
      id,
      description: f.description,
      action: f.action,
      section: f.section,
      skills: f.skills,
      session: f.session,
      timeLimitSeconds: f.time_limit,
      body: parts.body,
    };
    const skillDefinitions = f.skills.map((s) => skills.get(s) as SkillDefinition);
    agents.push({ ...definition, version: agentVersion(definition, skillDefinitions), skillDefinitions });
  }
  for (const [action, id] of Object.entries(DEFAULT_AGENTS)) {
    const agent = agents.find((a) => a.id === id);
    if (agents.length > 0 && agent && agent.action !== action) {
      problems.push(`${id}: it is the default agent of ${action} but serves ${agent.action}.`);
    }
  }
  if (problems.length > 0) throw new Error(`Invalid agent catalog in ${root}:\n- ${problems.join('\n- ')}`);
  const byId = new Map(agents.map((a) => [a.id, a]));
  return {
    agents,
    skills: [...skills.values()],
    get: (id) => byId.get(id),
    defaultFor(action) {
      const agent = byId.get(DEFAULT_AGENTS[action]);
      if (!agent) throw new Error(`The catalog has no default agent for ${action}.`);
      return agent;
    },
  };
}

const cache = new Map<string, Promise<AgentCatalog>>();

/** Loads (once per folder) and validates the agents and skills under `root` (`packages/core` by default). */
export function loadAgentCatalog(root: string = ROOT): Promise<AgentCatalog> {
  let catalog = cache.get(root);
  if (!catalog) {
    catalog = load(root);
    cache.set(root, catalog);
    catalog.catch(() => cache.delete(root));
  }
  return catalog;
}

/** Output schema version: short fingerprint of the JSON Schema generated from Zod. */
export function schemaVersion(action: AgentAction): string {
  return fingerprint(jsonSchemaOf(action)).slice(0, 16);
}
