// JSON Schema variants per provider. Strict structured-output modes (Codex/OpenAI, and the tool
// parameters of local models) reject some keywords of the schemas Zod generates: they are dropped
// here, purely and deterministically. Zod still judges the output against the full schema.

const DROPPED = new Set(['$schema', 'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems']);

export function strictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v !== 'object' || v === null) return v;
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => !DROPPED.has(k))
        .map(([k, x]) => [k, walk(x)]),
    );
  };
  return walk(schema) as Record<string, unknown>;
}
