// Lectura y escritura del formato fijo de `design/`.
// Regla central: un documento es válido solo si `renderizar(parsear(texto)) === texto`.
// Así la exportación desde la v2 reproduce `design/` byte a byte.

import { parse as parsearYaml, stringify as serializarYaml } from 'yaml';
import { z } from 'zod';
import {
  ESTADOS_DOCUMENTO,
  PREFIJOS,
  SECCION_CRITERIOS,
  TIPOS_ENLACE,
  TIPOS_REGISTRO,
  VERIFICACIONES,
  type Criterio,
  type Documento,
  type DocumentoRegistro,
  type DocumentoTaxonomia,
  type Enlace,
  type Problema,
  type Referencia,
  type Resultado,
  type Seccion,
} from './tipos.ts';

const RE_CODIGO_REGISTRO = /^(DEC|ADR|FDR|BUG)-[A-Z]{3}-\d{3}$/;
const RE_CODIGO_TAXONOMIA = /^TAX-\d{3}$/;
const RE_REFERENCIA = /^((?:DEC|ADR|FDR|BUG)-[A-Z]{3}-\d{3}|TAX-\d{3})@(\d+)$/;
const RE_CODIGO_AC = /^AC-[A-Z]{3}-\d{3}-\d{2}$/;
const SEPARADOR = ' · ';

const esquemaFrontRegistro = z
  .object({
    codigo: z.string().regex(RE_CODIGO_REGISTRO, 'El código debe tener la forma TIP-DOM-NNN'),
    tipo: z.enum(TIPOS_REGISTRO),
    titulo: z.string().min(3),
    version: z.number().int().positive(),
    estado: z.enum(ESTADOS_DOCUMENTO),
    dominio: z.string().regex(/^[a-z][a-z0-9_]*$/),
    incremento: z
      .string()
      .regex(/^(D|S|H)\d+$/)
      .optional(),
    nota_de_cambio: z.string().min(1).optional(),
    enlaces: z.array(
      z.object({ tipo: z.enum(TIPOS_ENLACE), destino: z.string().regex(RE_REFERENCIA, 'Referencia CODIGO@version') }).strict(),
    ),
    anexos: z.array(z.string().regex(/^datos\/[a-z0-9-]+\.yaml$/)),
  })
  .strict();

const esquemaFrontTaxonomia = z
  .object({
    codigo: z.string().regex(RE_CODIGO_TAXONOMIA, 'El código debe tener la forma TAX-NNN'),
    tipo: z.literal('taxonomia'),
    titulo: z.string().min(3),
    version: z.number().int().positive(),
    estado: z.enum(ESTADOS_DOCUMENTO),
    ejes: z
      .array(
        z
          .object({
            codigo: z.string().regex(/^[a-z][a-z0-9_]*$/),
            nombre: z.string().min(1),
            categorias: z
              .array(
                z
                  .object({
                    codigo: z.string().regex(/^[a-z][a-z0-9_]*$/),
                    nombre: z.string().min(1),
                    descripcion: z.string().min(1),
                  })
                  .strict(),
              )
              .min(2),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export function parsearReferencia(texto: string): Referencia | null {
  const m = RE_REFERENCIA.exec(texto);
  if (!m?.[1] || !m[2]) return null;
  return { codigo: m[1], version: Number(m[2]) };
}

export function formatearReferencia(ref: Referencia): string {
  return `${ref.codigo}@${ref.version}`;
}

function separarFrontmatter(texto: string, ruta: string): Resultado<{ front: unknown; cuerpo: string }> {
  if (texto.includes('\r')) {
    return fallo(ruta, 'El archivo usa finales de línea CRLF; el formato exige LF.');
  }
  // Los espacios finales sobreviven a parsear y renderizar, así que la regla canónica no
  // los detecta: se rechazan aquí.
  const conEspacios = texto.split('\n').findIndex((l) => /[ \t]$/.test(l));
  if (conEspacios >= 0) {
    return fallo(ruta, `La línea ${conEspacios + 1} termina con espacios; el formato no los admite.`);
  }
  if (!texto.startsWith('---\n')) return fallo(ruta, 'Falta el frontmatter: el archivo debe empezar por «---».');
  const fin = texto.indexOf('\n---\n', 3);
  if (fin < 0) return fallo(ruta, 'El frontmatter no está cerrado con «---».');
  const yaml = texto.slice(4, fin + 1);
  try {
    return { ok: true, valor: { front: parsearYaml(yaml) as unknown, cuerpo: texto.slice(fin + 5) } };
  } catch (e) {
    return fallo(ruta, `El frontmatter no es YAML válido: ${(e as Error).message}`);
  }
}

function fallo<T>(ruta: string, mensaje: string): Resultado<T> {
  return { ok: false, problemas: [{ ruta, mensaje }] };
}

function problemasZod(ruta: string, error: z.ZodError): Problema[] {
  return error.issues.map((i) => ({ ruta, mensaje: `Frontmatter: ${i.path.join('.') || '(raíz)'}: ${i.message}` }));
}

type Bloque = { titulo: string; lineas: string[] };

/** Divide un cuerpo en bloques por encabezados con el prefijo dado («## » o «### »). */
function dividir(lineas: string[], prefijo: string): { antes: string[]; bloques: Bloque[] } {
  const antes: string[] = [];
  const bloques: Bloque[] = [];
  for (const linea of lineas) {
    if (linea.startsWith(prefijo)) {
      bloques.push({ titulo: linea.slice(prefijo.length), lineas: [] });
    } else if (bloques.length === 0) {
      antes.push(linea);
    } else {
      bloques[bloques.length - 1]?.lineas.push(linea);
    }
  }
  return { antes, bloques };
}

function recortar(lineas: string[]): string {
  let ini = 0;
  let fin = lineas.length;
  while (ini < fin && lineas[ini]?.trim() === '') ini++;
  while (fin > ini && lineas[fin - 1]?.trim() === '') fin--;
  return lineas.slice(ini, fin).join('\n');
}

function parsearCuerpo(
  cuerpo: string,
  ruta: string,
  codigo: string,
  titulo: string,
): Resultado<{ secciones: Seccion[]; criteriosTexto: string | null }> {
  const lineas = cuerpo.split('\n');
  const { antes, bloques } = dividir(lineas, '## ');
  const cabecera = recortar(antes);
  const esperado = `# ${codigo}${SEPARADOR}${titulo}`;
  if (cabecera !== esperado) {
    return fallo(ruta, `El título del cuerpo debe ser exactamente «${esperado}».`);
  }
  const secciones: Seccion[] = [];
  let criteriosTexto: string | null = null;
  const problemas: Problema[] = [];
  for (const [i, b] of bloques.entries()) {
    const contenido = recortar(b.lineas);
    if (b.titulo === SECCION_CRITERIOS) {
      if (i !== bloques.length - 1) problemas.push({ ruta, mensaje: `«${SECCION_CRITERIOS}» debe ser la última sección.` });
      criteriosTexto = contenido;
      continue;
    }
    if (contenido === '') problemas.push({ ruta, mensaje: `La sección «${b.titulo}» está vacía.` });
    secciones.push({ titulo: b.titulo, contenido });
  }
  if (problemas.length > 0) return { ok: false, problemas };
  return { ok: true, valor: { secciones, criteriosTexto } };
}

const RE_CABECERA_AC = /^(AC-[A-Z]{3}-\d{3}-\d{2}) · (.+)$/;

function parsearCriterios(texto: string, ruta: string): Resultado<Criterio[]> {
  const { antes, bloques } = dividir(texto.split('\n'), '### ');
  if (recortar(antes) !== '') return fallo(ruta, `Hay texto en «${SECCION_CRITERIOS}» antes del primer criterio.`);
  const criterios: Criterio[] = [];
  const problemas: Problema[] = [];
  for (const b of bloques) {
    const m = RE_CABECERA_AC.exec(b.titulo);
    if (!m?.[1] || !m[2]) {
      problemas.push({ ruta, mensaje: `Cabecera de criterio inválida: «### ${b.titulo}». Forma: «### AC-DOM-NNN-NN · Título».` });
      continue;
    }
    const codigo = m[1];
    const lineas = b.lineas;
    let k = 0;
    while (k < lineas.length && lineas[k]?.trim() === '') k++;
    const verif = /^- Verificación: (.+)$/.exec(lineas[k] ?? '');
    const compr = /^- Comprobación: (.+)$/.exec(lineas[k + 1] ?? '');
    if (!verif?.[1] || !compr?.[1]) {
      problemas.push({ ruta, mensaje: `${codigo}: faltan «- Verificación:» y «- Comprobación:» justo después de la cabecera.` });
      continue;
    }
    if (!(VERIFICACIONES as readonly string[]).includes(verif[1])) {
      problemas.push({ ruta, mensaje: `${codigo}: la verificación debe ser «automática» o «manual».` });
      continue;
    }
    k += 2;
    let derivaDe: string | undefined;
    const deriva = /^- Deriva de: (.+)$/.exec(lineas[k] ?? '');
    if (deriva?.[1]) {
      derivaDe = deriva[1];
      k++;
      if (!RE_CODIGO_AC.test(derivaDe))
        problemas.push({ ruta, mensaje: `${codigo}: «Deriva de» debe ser un código de criterio.` });
    }
    const enunciado = recortar(lineas.slice(k));
    if (enunciado === '') {
      problemas.push({ ruta, mensaje: `${codigo}: falta el enunciado observable.` });
      continue;
    }
    const criterio: Criterio = {
      codigo,
      titulo: m[2],
      verificacion: verif[1] as Criterio['verificacion'],
      comprobacion: compr[1],
      enunciado,
    };
    if (derivaDe) criterio.derivaDe = derivaDe;
    criterios.push(criterio);
  }
  if (problemas.length > 0) return { ok: false, problemas };
  return { ok: true, valor: criterios };
}

export function parsearDocumento(texto: string, ruta: string): Resultado<Documento> {
  const sep = separarFrontmatter(texto, ruta);
  if (!sep.ok) return sep;
  const { front, cuerpo } = sep.valor;
  const tipo = (front as { tipo?: unknown } | null)?.tipo;
  if (tipo === 'taxonomia') {
    const r = esquemaFrontTaxonomia.safeParse(front);
    if (!r.success) return { ok: false, problemas: problemasZod(ruta, r.error) };
    const c = parsearCuerpo(cuerpo, ruta, r.data.codigo, r.data.titulo);
    if (!c.ok) return c;
    if (c.valor.criteriosTexto !== null) return fallo(ruta, 'Una taxonomía no lleva criterios de aceptación.');
    const doc: DocumentoTaxonomia = {
      clase: 'taxonomia',
      codigo: r.data.codigo,
      titulo: r.data.titulo,
      version: r.data.version,
      estado: r.data.estado,
      ejes: r.data.ejes,
      secciones: c.valor.secciones,
    };
    return { ok: true, valor: doc };
  }
  const r = esquemaFrontRegistro.safeParse(front);
  if (!r.success) return { ok: false, problemas: problemasZod(ruta, r.error) };
  const f = r.data;
  if (!f.codigo.startsWith(`${PREFIJOS[f.tipo]}-`)) {
    return fallo(ruta, `El código ${f.codigo} no corresponde al tipo «${f.tipo}» (prefijo ${PREFIJOS[f.tipo]}).`);
  }
  const c = parsearCuerpo(cuerpo, ruta, f.codigo, f.titulo);
  if (!c.ok) return c;
  let criterios: Criterio[] = [];
  if (c.valor.criteriosTexto !== null) {
    const pc = parsearCriterios(c.valor.criteriosTexto, ruta);
    if (!pc.ok) return pc;
    criterios = pc.valor;
  }
  const enlaces: Enlace[] = f.enlaces.map((e) => ({
    tipo: e.tipo,
    destino: parsearReferencia(e.destino) as Referencia,
  }));
  const doc: DocumentoRegistro = {
    clase: 'registro',
    tipo: f.tipo,
    codigo: f.codigo,
    titulo: f.titulo,
    version: f.version,
    estado: f.estado,
    dominio: f.dominio,
    enlaces,
    anexos: f.anexos,
    secciones: c.valor.secciones,
    criterios,
  };
  if (f.incremento) doc.incremento = f.incremento;
  if (f.nota_de_cambio) doc.notaDeCambio = f.nota_de_cambio;
  return { ok: true, valor: doc };
}

function aYaml(objeto: Record<string, unknown>): string {
  return serializarYaml(objeto, { lineWidth: 0, indent: 2, indentSeq: true });
}

function renderizarCriterio(c: Criterio): string {
  const lineas = [
    `### ${c.codigo}${SEPARADOR}${c.titulo}`,
    '',
    `- Verificación: ${c.verificacion}`,
    `- Comprobación: ${c.comprobacion}`,
  ];
  if (c.derivaDe) lineas.push(`- Deriva de: ${c.derivaDe}`);
  lineas.push('', c.enunciado);
  return lineas.join('\n');
}

export function renderizarDocumento(doc: Documento): string {
  let front: Record<string, unknown>;
  if (doc.clase === 'taxonomia') {
    front = {
      codigo: doc.codigo,
      tipo: 'taxonomia',
      titulo: doc.titulo,
      version: doc.version,
      estado: doc.estado,
      ejes: doc.ejes,
    };
  } else {
    front = {
      codigo: doc.codigo,
      tipo: doc.tipo,
      titulo: doc.titulo,
      version: doc.version,
      estado: doc.estado,
      dominio: doc.dominio,
    };
    if (doc.incremento) front.incremento = doc.incremento;
    if (doc.notaDeCambio) front.nota_de_cambio = doc.notaDeCambio;
    front.enlaces = doc.enlaces.map((e) => ({ tipo: e.tipo, destino: formatearReferencia(e.destino) }));
    front.anexos = doc.anexos;
  }
  const partes = [`---\n${aYaml(front)}---`, `# ${doc.codigo}${SEPARADOR}${doc.titulo}`];
  for (const s of doc.secciones) partes.push(`## ${s.titulo}\n\n${s.contenido}`);
  if (doc.clase === 'registro' && doc.criterios.length > 0) {
    partes.push(`## ${SECCION_CRITERIOS}\n\n${doc.criterios.map(renderizarCriterio).join('\n\n')}`);
  }
  return `${partes.join('\n\n')}\n`;
}
