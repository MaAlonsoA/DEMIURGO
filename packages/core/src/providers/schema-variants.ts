// JSON Schema variants per provider. Strict structured-output modes (Codex/OpenAI, and the tool
// parameters of local models) reject some keywords of the schemas Zod generates: they are dropped
// or rewritten here, purely and deterministically. Zod still judges the output against the full
// schema.

const DROPPED = new Set(['$schema', 'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems']);

/** Strict mode only takes anyOf for unions: Zod's discriminated unions come out as oneOf. */
const RENAMED: Record<string, string> = { oneOf: 'anyOf' };

export function strictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v !== 'object' || v === null) return v;
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => !DROPPED.has(k))
        // A constant is a one-value enum, which every strict mode accepts.
        .map(([k, x]) => (k === 'const' ? ['enum', [x]] : [RENAMED[k] ?? k, walk(x)])),
    );
  };
  return walk(schema) as Record<string, unknown>;
}
