// design_directions action: in a design-system thread, a dedicated agent proposes two or three visual
// directions, each with a style tile (Samantha Warren). It proposes nothing to accept: the directions
// stay in the run's output, where the thread shows them, and the person picks one with a message
// ("I choose direction: <name>"). The checker gates the output after the model call: distinct names,
// safe tiles and contrast, the same pattern as the drafting agents.

import {
  CHOOSE_DIRECTION_PREFIX,
  DomainError,
  TEXT_CONTRAST_MIN,
  type ActionOutput,
  contrastRatio,
} from '@demiurgo/domain';
import { sql } from 'kysely';
import { registerBuilder } from '../context/build.ts';
import type { Db, Tx } from '../db/connection.ts';
import { registerApplier, registerChecker } from './appliers.ts';
import { designThreadOf, relabelPack } from './drafting.ts';
import { explorationPack } from './exploration-chat.ts';

const BUILDER = 'design_directions@1';

type Direction = ActionOutput<'design_directions'>['directions'][number];

/** The direction the person last chose in the thread, with what its run stored, or null when none was chosen (or it is not found). */
export async function chosenDirection(db: Db | Tx, projectId: string, explorationId: string): Promise<Pick<Direction, 'name' | 'why' | 'tokens'> | null> {
  const msg = await db
    .selectFrom('messages')
    .select('body')
    .where('exploration_id', '=', explorationId)
    .where('author', 'like', 'human:%')
    .where('body', 'like', `${CHOOSE_DIRECTION_PREFIX}%`)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  if (!msg) return null;
  const name = msg.body.slice(CHOOSE_DIRECTION_PREFIX.length).trim();
  const runs = await sql<{ output: ActionOutput<'design_directions'> | null }>`
    select output from ai_runs
    where project_id = ${projectId}::uuid and action = 'design_directions' and state = 'completed' and scope->>'id' = ${explorationId}
    order by created_at desc, id desc`.execute(db);
  for (const r of runs.rows) {
    const d = r.output?.directions?.find((x) => x.name.trim().toLowerCase() === name.toLowerCase());
    if (d) return { name: d.name, why: d.why, tokens: d.tokens };
  }
  return null;
}

registerBuilder('design_directions', async (a) => {
  if (a.scope.type !== 'exploration' || !a.scope.id) throw new DomainError('validation', 'Visual directions are proposed from a design-system thread.');
  const thread = await designThreadOf(a.trx, a.projectId, a.scope.id);
  if (!thread) throw new DomainError('validation', 'This thread is not about a design system.');
  // The thread's path and base (`design_system`) are already in the exploration's pack.
  return relabelPack(await explorationPack(a), BUILDER);
});

/** Problems of one direction's tile and tokens, in words the agent reads. */
export function directionProblems(d: Direction): string[] {
  const notes: string[] = [];
  if (/<script/i.test(d.tile_html)) notes.push(`The tile of "${d.name}" has a <script>: a style tile is HTML and CSS only.`);
  if (/https?:|\/\/[a-z]/i.test(d.tile_html.replace(/<!--[\s\S]*?-->/g, '')))
    notes.push(`The tile of "${d.name}" points to an external URL (http): it is self-contained; use system fonts and no external images.`);
  if (!/<style[\s>]/i.test(d.tile_html) && !/style=/i.test(d.tile_html)) notes.push(`The tile of "${d.name}" has no CSS: show the colors and the type.`);
  const first = (n: string) => n.split(/[-._]|(?=[A-Z])/)[0]?.toLowerCase() ?? '';
  const colors = Object.entries(d.tokens.color);
  const texts = colors.filter(([n]) => ['text', 'fg'].includes(first(n)));
  const backgrounds = colors.filter(([n]) => ['bg', 'surface'].includes(first(n)));
  if (texts.length === 0 || backgrounds.length === 0)
    notes.push(`The colors of "${d.name}" need a text token (text* or fg*) and a background token (bg* or surface*), so contrast can be checked.`);
  for (const [tn, tv] of texts)
    for (const [bn, bv] of backgrounds)
      for (const theme of ['light', 'dark'] as const) {
        const r = contrastRatio(tv.$value[theme], bv.$value[theme]);
        if (r < TEXT_CONTRAST_MIN)
          notes.push(
            `"${d.name}": "${tn}" on "${bn}" in the ${theme} theme is ${r.toFixed(2)}:1; WCAG 2.2 AA needs ${TEXT_CONTRAST_MIN}:1. Change one of the two colors.`,
          );
      }
  return notes;
}

registerChecker('design_directions', async ({ output }) => {
  const notes: string[] = [];
  const names = output.directions.map((d) => d.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) notes.push('Two directions have the same name: each one needs its own name.');
  for (const d of output.directions) notes.push(...directionProblems(d));
  return notes;
});

// No effects: the directions stay in the run's output and the thread shows them.
registerApplier('design_directions', async () => undefined);
