// The aspect of a text (domain/aspects.ts), as Jev (TypeSafe) judges it: one Choice per text, on
// the text alone, never on its thread or stage. It classifies each message a person writes in a
// thread and each proposal's own text (to check the aspect its agent chose). It is derived data:
// it runs after the commit, never blocks a command and a failure only leaves it unclassified.
//
// It is a tool of this DEMIURGO build, not a decision of the product being designed: the key
// (TYPESAFE_API_KEY) turns it on; without it, nothing leaves the machine.

import { ASPECTS, ASPECT_DESCRIPTIONS, type Aspect, isAspect } from '@demiurgo/domain';
import type { Services } from '../services.ts';
import { createJevClassifier, jevCostUsd } from './jev.ts';

const QUESTION = 'Which part of the product is this text mainly about?';
const MAX_TEXT = 8000;

export type AspectJudgment = { aspect: Aspect; confidence: number };

/** Whether Jev is on: the key is set. */
export function jevAllowed(): boolean {
  return !!process.env.TYPESAFE_API_KEY;
}

/** Each text's aspect, by id; nothing when Jev is not allowed. */
export async function classifyAspects(
  services: Pick<Services, 'db' | 'logger'>,
  projectId: string,
  texts: readonly { id: string; text: string }[],
): Promise<Map<string, AspectJudgment>> {
  const out = new Map<string, AspectJudgment>();
  const items = texts.filter((t) => t.text.trim());
  if (items.length === 0 || !jevAllowed()) return out;
  let tokens = 0;
  const jev = createJevClassifier({ apiKey: process.env.TYPESAFE_API_KEY, onUsage: (u) => (tokens += u.input_tokens) });
  const answers = await jev.choice(
    items.map((t) => ({
      id: t.id,
      state: t.text.slice(0, MAX_TEXT),
      question: QUESTION,
      options: [...ASPECTS],
      optionDescriptions: ASPECT_DESCRIPTIONS,
    })),
  );
  for (const a of answers) if (isAspect(a.choice)) out.set(a.id, { aspect: a.choice, confidence: a.confidence });
  services.logger.info('Jev classified aspects', { projectId, texts: items.length, input_tokens: tokens, usd: jevCostUsd(tokens) });
  return out;
}

/** Classifies a message a person wrote, after the commit. */
export async function classifyMessage(services: Services, projectId: string, messageId: string, text: string): Promise<void> {
  try {
    const r = (await classifyAspects(services, projectId, [{ id: messageId, text }])).get(messageId);
    if (r)
      await services.db
        .updateTable('messages')
        .set({ aspect: r.aspect, aspect_confidence: r.confidence })
        .where('id', '=', messageId)
        .execute();
  } catch (err) {
    services.logger.error('Jev could not classify a message', { messageId, error: String(err) });
  }
}

/** The text a proposal says, for its aspect: its title and prose, never its thread's. */
export function proposalText(type: string, payload: Record<string, unknown>): string | null {
  const str = (k: string) => (typeof payload[k] === 'string' ? (payload[k] as string) : '');
  if (type === 'decision') return [str('title'), str('context'), str('decision'), str('consequences')].join('\n\n');
  if (type === 'fdr') return [str('title'), str('goal'), str('scope'), str('behavior')].join('\n\n');
  if (type === 'design_record') {
    const sections = Array.isArray(payload.sections) ? (payload.sections as { title?: string; content?: string }[]) : [];
    return [str('title'), ...sections.map((s) => `${s.title ?? ''}: ${s.content ?? ''}`)].join('\n\n');
  }
  return null;
}

/** Classifies the proposals of a batch on their own text, after the commit. */
export async function classifyBatch(services: Services, projectId: string, batchId: string): Promise<void> {
  try {
    const proposals = await services.db
      .selectFrom('proposals')
      .select(['id', 'type', 'payload'])
      .where('batch_id', '=', batchId)
      .execute();
    const texts = proposals.flatMap((p) => {
      const text = proposalText(p.type, p.payload as Record<string, unknown>);
      return text ? [{ id: p.id, text }] : [];
    });
    const judged = await classifyAspects(services, projectId, texts);
    for (const [id, r] of judged)
      await services.db
        .updateTable('proposals')
        .set({ aspect_check: JSON.stringify(r) })
        .where('id', '=', id)
        .execute();
  } catch (err) {
    services.logger.error('Jev could not classify a batch', { batchId, error: String(err) });
  }
}
