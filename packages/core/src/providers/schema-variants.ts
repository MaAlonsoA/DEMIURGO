// JSON Schema variants per provider. Strict structured-output modes (Codex/OpenAI, and the tool
// parameters of local models) reject some keywords of the schemas Zod generates: they are dropped
// or rewritten here, purely and deterministically. Zod still judges the output against the full
// schema.

const DROPPED = new Set(['$schema', 'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems']);

/** Strict mode only takes anyOf for unions: Zod's discriminated unions come out as oneOf. */
const RENAMED: Record<string, string> = { oneOf: 'anyOf' };

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Strict mode also requires every property to be listed in `required`: an optional property
 * becomes required and nullable, and `dropOptionalNulls` removes those nulls from the answer.
 */
export function strictSchema(schema: Json): Json {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!isObj(v)) return v;
    const out = Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => !DROPPED.has(k))
        // A constant is a one-value enum, which every strict mode accepts.
        .map(([k, x]) => (k === 'const' ? ['enum', [x]] : [RENAMED[k] ?? k, walk(x)])),
    ) as Json;
    if (isObj(out.properties)) {
      const required = new Set(Array.isArray(v.required) ? (v.required as string[]) : []);
      const props = out.properties;
      out.properties = Object.fromEntries(
        Object.entries(props).map(([k, p]) => [k, required.has(k) ? p : { anyOf: [p, { type: 'null' }] }]),
      );
      out.required = Object.keys(props);
    }
    return out;
  };
  return walk(schema) as Json;
}

/** Removes the nulls strict mode forced into properties the original schema leaves optional. */
export function dropOptionalNulls(schema: Json, value: unknown): unknown {
  const walk = (s: unknown, v: unknown): unknown => {
    if (!isObj(s)) return v;
    const branches = [...(Array.isArray(s.anyOf) ? s.anyOf : []), ...(Array.isArray(s.oneOf) ? s.oneOf : [])];
    if (branches.length > 0) {
      const branch = branches.find((b) => isObj(b) && isObj(b.properties) && isObj(v) && Object.keys(v).every((k) => k in (b.properties as Json)));
      return branch ? walk(branch, v) : Array.isArray(v) ? branches.reduce((acc: unknown, b) => walk(b, acc), v) : v;
    }
    if (Array.isArray(v)) return isObj(s.items) ? v.map((x) => walk(s.items, x)) : v;
    if (!isObj(v) || !isObj(s.properties)) return v;
    const props = s.properties;
    const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k, x]) => !(x === null && k in props && !required.has(k)))
        .map(([k, x]) => [k, walk(props[k], x)]),
    );
  };
  return walk(schema, value);
}
