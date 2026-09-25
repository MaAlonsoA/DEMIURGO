// Text normalization for deterministic comparisons (simulated classifier and candidate
// preselection). Handles both Spanish and English text. No dependencies, no I/O.

const SPANISH_STOP_WORDS =
  'a al algo algun alguna algunas alguno algunos ante antes aqui asi aun bajo bien cada como con contra cual cuales cuando de del desde donde dos el ella ellas ellos en entre era es esa esas ese eso esos esta estan estar estas este esto estos fue ha hace hacen hacer han hasta hay la las le les lo los mas me mi mismo muy nada ni no nos o otra otras otro otros para pero poco por porque puede pueden que quien se sea segun ser si sido sin sobre solo son su sus tambien tan tanto te tiene tienen todo todos tras tu un una unas uno unos usar ya y cada debe deben puede sera seran queda quedan';

const ENGLISH_STOP_WORDS =
  'a about above after again against all also am an and any are as at be because been before being below between both but by can cannot could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with without would you your yours yourself yourselves';

const STOP_WORDS = new Set(`${SPANISH_STOP_WORDS} ${ENGLISH_STOP_WORDS}`.split(' '));

export function withoutAccents(t: string): string {
  return t.normalize('NFD').replace(/\p{Mn}/gu, '');
}

/** Approximate stem: strips plurals and some common endings (Spanish and English). */
export function root(word: string): string {
  let p = word;
  for (const suffix of [
    'aciones',
    'acion',
    'ations',
    'ation',
    'amiento',
    'imientos',
    'imiento',
    'ments',
    'ment',
    'mente',
    'ly',
    'idades',
    'idad',
    'ities',
    'ity',
    'ciones',
    'cion',
    'es',
    's',
  ]) {
    if (p.length > suffix.length + 3 && p.endsWith(suffix)) {
      p = p.slice(0, -suffix.length);
      break;
    }
  }
  return p;
}

export function tokens(text: string): string[] {
  return withoutAccents(text.toLowerCase())
    .split(/[^a-z0-9ñ]+/)
    .filter((p) => p.length >= 3 && !STOP_WORDS.has(p))
    .map(root);
}

export function tokenSet(text: string): Set<string> {
  return new Set(tokens(text));
}

/** Jaccard index between the token sets of two texts. */
export function similarity(a: string, b: string): number {
  const x = tokenSet(a);
  const y = tokenSet(b);
  if (x.size === 0 || y.size === 0) return 0;
  let common = 0;
  for (const f of x) if (y.has(f)) common++;
  return common / (x.size + y.size - common);
}

/** Proportion of a's tokens that also appear in b (asymmetric coverage). */
export function overlap(a: string, b: string): number {
  const x = tokenSet(a);
  const y = tokenSet(b);
  if (x.size === 0) return 0;
  let common = 0;
  for (const f of x) if (y.has(f)) common++;
  return common / x.size;
}

/**
 * JSON ready to sit between delimiters: `<` and `>` are written with their JSON Unicode escape,
 * so untrusted data can never close the tag that delimits it. It remains
 * equivalent JSON.
 */
export function delimitedJson(value: unknown, indent = 2): string {
  return (JSON.stringify(value, null, indent) ?? 'null').replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
}
