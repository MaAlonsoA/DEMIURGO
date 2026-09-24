// Normalización de texto en español para comparaciones deterministas (clasificador simulado
// y preselección de candidatos). Sin dependencias ni E/S.

const PALABRAS_VACIAS = new Set(
  'a al algo algun alguna algunas alguno algunos ante antes aqui asi aun bajo bien cada como con contra cual cuales cuando de del desde donde dos el ella ellas ellos en entre era es esa esas ese eso esos esta estan estar estas este esto estos fue ha hace hacen hacer han hasta hay la las le les lo los mas me mi mismo muy nada ni no nos o otra otras otro otros para pero poco por porque puede pueden que quien se sea segun ser si sido sin sobre solo son su sus tambien tan tanto te tiene tienen todo todos tras tu un una unas uno unos usar ya y cada debe deben puede sera seran queda quedan'.split(
    ' ',
  ),
);

export function sinAcentos(t: string): string {
  return t.normalize('NFD').replace(/\p{Mn}/gu, '');
}

/** Raíz aproximada: quita plurales y algunas terminaciones frecuentes. */
export function raiz(palabra: string): string {
  let p = palabra;
  for (const suf of [
    'aciones',
    'acion',
    'amiento',
    'imientos',
    'imiento',
    'mente',
    'idades',
    'idad',
    'ciones',
    'cion',
    'es',
    's',
  ]) {
    if (p.length > suf.length + 3 && p.endsWith(suf)) {
      p = p.slice(0, -suf.length);
      break;
    }
  }
  return p;
}

export function fichas(texto: string): string[] {
  return sinAcentos(texto.toLowerCase())
    .split(/[^a-z0-9ñ]+/)
    .filter((p) => p.length >= 3 && !PALABRAS_VACIAS.has(p))
    .map(raiz);
}

export function conjuntoFichas(texto: string): Set<string> {
  return new Set(fichas(texto));
}

/** Índice de Jaccard entre los conjuntos de fichas de dos textos. */
export function similitud(a: string, b: string): number {
  const x = conjuntoFichas(a);
  const y = conjuntoFichas(b);
  if (x.size === 0 || y.size === 0) return 0;
  let comunes = 0;
  for (const f of x) if (y.has(f)) comunes++;
  return comunes / (x.size + y.size - comunes);
}

/** Proporción de las fichas de `a` que aparecen en `b` (cobertura asimétrica). */
export function solape(a: string, b: string): number {
  const x = conjuntoFichas(a);
  const y = conjuntoFichas(b);
  if (x.size === 0) return 0;
  let comunes = 0;
  for (const f of x) if (y.has(f)) comunes++;
  return comunes / x.size;
}
