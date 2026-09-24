// Validación de un árbol `design/` completo, expresado como un mapa ruta → texto.
// Es puro: la lectura del disco está en `disco.ts`.

import { incoherenciasTablas, esquemaCapacidades, esquemaTransiciones } from '@demiurgo/domain/tablas/esquemas';
import { leerYaml, parsearDocumento, problemasDeEspacios, renderizarDocumento } from './formato.ts';
import { README_DISENO } from './readme.ts';
import { CARPETAS, PLANTILLAS, type Documento, type DocumentoRegistro, type DocumentoTaxonomia, type Problema } from './tipos.ts';

export type ArbolDiseno = ReadonlyMap<string, string>;

export type InformeValidacion = {
  problemas: Problema[];
  registros: DocumentoRegistro[];
  taxonomias: DocumentoTaxonomia[];
  anexos: Map<string, string>;
};

const CARPETA_A_CLASE = new Map<string, string>(Object.entries(CARPETAS).map(([tipo, carpeta]) => [carpeta, tipo]));

export function validarArbol(arbol: ArbolDiseno): InformeValidacion {
  const problemas: Problema[] = [];
  const registros: DocumentoRegistro[] = [];
  const taxonomias: DocumentoTaxonomia[] = [];
  const anexos = new Map<string, string>();

  if (!arbol.has('README.md')) problemas.push({ ruta: 'README.md', mensaje: 'Falta README.md.' });

  for (const [ruta, texto] of [...arbol.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (ruta === 'README.md') {
      if (texto !== README_DISENO) {
        problemas.push({ ruta, mensaje: 'README.md no coincide con el texto fijo; ejecuta «canonizar».' });
      }
      continue;
    }
    const partes = ruta.split('/');
    if (partes.length !== 2) {
      problemas.push({ ruta, mensaje: 'Archivo fuera de la estructura de design/.' });
      continue;
    }
    const [carpeta, nombre] = partes as [string, string];
    if (carpeta === 'datos') {
      if (!nombre.endsWith('.yaml')) problemas.push({ ruta, mensaje: 'En datos/ solo hay archivos .yaml.' });
      else anexos.set(ruta, texto);
      continue;
    }
    const tipo = CARPETA_A_CLASE.get(carpeta);
    if (!tipo || !nombre.endsWith('.md')) {
      problemas.push({ ruta, mensaje: 'Archivo fuera de la estructura de design/.' });
      continue;
    }
    const r = parsearDocumento(texto, ruta);
    if (!r.ok) {
      problemas.push(...r.problemas);
      continue;
    }
    const doc: Documento = r.valor;
    const tipoDoc = doc.clase === 'taxonomia' ? 'taxonomia' : doc.tipo;
    if (tipoDoc !== tipo) problemas.push({ ruta, mensaje: `Un documento de tipo «${tipoDoc}» no va en ${carpeta}/.` });
    if (nombre !== `${doc.codigo}.md`) problemas.push({ ruta, mensaje: `El archivo debe llamarse ${doc.codigo}.md.` });
    if (renderizarDocumento(doc) !== texto) {
      problemas.push({ ruta, mensaje: 'No está en formato canónico; ejecuta «node packages/design/src/cli.ts canonizar».' });
    }
    if (doc.clase === 'taxonomia') taxonomias.push(doc);
    else registros.push(doc);
  }

  problemas.push(...comprobarRegistros(registros, anexos));
  problemas.push(...comprobarTaxonomias(taxonomias));
  problemas.push(...comprobarAnexos(anexos, registros));
  return { problemas, registros, taxonomias, anexos };
}

function rutaDe(doc: Documento): string {
  return `${CARPETAS[doc.clase === 'taxonomia' ? 'taxonomia' : doc.tipo]}/${doc.codigo}.md`;
}

function comprobarRegistros(registros: DocumentoRegistro[], anexos: Map<string, string>): Problema[] {
  const problemas: Problema[] = [];
  const porCodigo = new Map<string, DocumentoRegistro>();
  const porBase = new Map<string, string>();
  const codigosAc = new Map<string, string>();
  for (const r of registros) {
    const ruta = rutaDe(r);
    if (porCodigo.has(r.codigo)) problemas.push({ ruta, mensaje: `Código de registro duplicado: ${r.codigo}.` });
    porCodigo.set(r.codigo, r);
    // La parte DOM-NNN da nombre a los criterios (AC-DOM-NNN-NN): es única entre tipos.
    const base = r.codigo.slice(4);
    const otro = porBase.get(base);
    if (otro !== undefined && otro !== r.codigo) {
      problemas.push({
        ruta,
        mensaje: `${r.codigo} comparte ${base} con ${otro}: la parte DOM-NNN de un código es única entre tipos, porque sus criterios compartirían AC-${base}-NN.`,
      });
    }
    porBase.set(base, r.codigo);
    const plantilla = PLANTILLAS[r.tipo];
    let i = 0;
    for (const s of r.secciones) if (s.titulo === plantilla.secciones[i]) i++;
    if (i < plantilla.secciones.length) {
      problemas.push({
        ruta,
        mensaje: `Faltan secciones de la plantilla (en orden): ${plantilla.secciones.slice(i).join(', ')}.`,
      });
    }
    if (plantilla.exigeCriterios && r.criterios.length === 0) {
      problemas.push({ ruta, mensaje: 'Este tipo de registro exige al menos un criterio de aceptación.' });
    }
    if (r.version > 1 && !r.notaDeCambio) problemas.push({ ruta, mensaje: 'Una versión posterior a la 1 exige nota_de_cambio.' });
    // La v2 guarda estos textos sin espacios al principio ni al final: si los tuvieran, la exportación no coincidiría.
    const textos: [string, string | undefined][] = [
      ['El título', r.titulo],
      ['La nota de cambio', r.notaDeCambio],
      ...r.criterios.flatMap((c): [string, string][] => [
        [`${c.codigo}: el título`, c.titulo],
        [`${c.codigo}: el enunciado`, c.enunciado],
        [`${c.codigo}: la comprobación`, c.comprobacion],
      ]),
    ];
    for (const [campo, valor] of textos) {
      if (valor !== undefined && valor !== valor.trim()) {
        problemas.push({ ruta, mensaje: `${campo} empieza o acaba con espacios en blanco.` });
      }
    }
    for (const c of r.criterios) {
      if (!c.codigo.startsWith(`AC-${base}-`)) {
        problemas.push({ ruta, mensaje: `${c.codigo}: el código de un criterio de ${r.codigo} empieza por AC-${base}-.` });
      }
      const previo = codigosAc.get(c.codigo);
      if (previo) problemas.push({ ruta, mensaje: `Código de criterio duplicado: ${c.codigo} (también en ${previo}).` });
      codigosAc.set(c.codigo, r.codigo);
    }
    for (const a of r.anexos) {
      if (!anexos.has(a)) problemas.push({ ruta, mensaje: `El anexo ${a} no existe.` });
    }
  }
  for (const r of registros) {
    for (const e of r.enlaces) {
      const destino = porCodigo.get(e.destino.codigo);
      if (!destino) {
        problemas.push({ ruta: rutaDe(r), mensaje: `El enlace ${e.tipo} apunta a ${e.destino.codigo}, que no existe.` });
      } else if (e.destino.version > destino.version) {
        // Un enlace puede seguir en una versión anterior de su destino (mantenido tras revisarlo);
        // la importación comprueba que esa versión ya está en la v2.
        problemas.push({
          ruta: rutaDe(r),
          mensaje: `El enlace ${e.tipo} apunta a ${e.destino.codigo}@${e.destino.version}, posterior a la versión ${destino.version} de design/.`,
        });
      }
      if (e.destino.codigo === r.codigo)
        problemas.push({ ruta: rutaDe(r), mensaje: 'Un registro no puede enlazarse a sí mismo.' });
    }
    for (const c of r.criterios) {
      if (c.derivaDe === undefined) continue;
      if (c.derivaDe === c.codigo) {
        problemas.push({ ruta: rutaDe(r), mensaje: `${c.codigo}: un criterio no puede derivar de sí mismo.` });
      } else if (!codigosAc.has(c.derivaDe)) {
        problemas.push({ ruta: rutaDe(r), mensaje: `${c.codigo}: deriva de ${c.derivaDe}, que no existe en design/.` });
      }
    }
  }
  return problemas;
}

function comprobarTaxonomias(taxonomias: DocumentoTaxonomia[]): Problema[] {
  const problemas: Problema[] = [];
  const codigos = new Set<string>();
  for (const t of taxonomias) {
    const ruta = rutaDe(t);
    if (codigos.has(t.codigo)) problemas.push({ ruta, mensaje: `Código de taxonomía duplicado: ${t.codigo}.` });
    if (t.titulo !== t.titulo.trim()) problemas.push({ ruta, mensaje: 'El título empieza o acaba con espacios en blanco.' });
    codigos.add(t.codigo);
    const ejes = new Set<string>();
    for (const eje of t.ejes) {
      if (ejes.has(eje.codigo)) problemas.push({ ruta, mensaje: `Eje duplicado: ${eje.codigo}.` });
      ejes.add(eje.codigo);
      const cats = new Set<string>();
      for (const c of eje.categorias) {
        if (cats.has(c.codigo)) problemas.push({ ruta, mensaje: `Categoría duplicada en ${eje.codigo}: ${c.codigo}.` });
        cats.add(c.codigo);
      }
      if (!cats.has('otra')) problemas.push({ ruta, mensaje: `El eje ${eje.codigo} no tiene la categoría «otra».` });
    }
  }
  return problemas;
}

function comprobarAnexos(anexos: Map<string, string>, registros: DocumentoRegistro[]): Problema[] {
  const problemas: Problema[] = [];
  const referenciados = new Map<string, number>();
  for (const r of registros) for (const a of r.anexos) referenciados.set(a, (referenciados.get(a) ?? 0) + 1);
  const leidos = new Map<string, unknown>();
  for (const [ruta, texto] of anexos) {
    const n = referenciados.get(ruta) ?? 0;
    if (n !== 1) problemas.push({ ruta, mensaje: `Un anexo debe pertenecer a exactamente un registro (ahora: ${n}).` });
    problemas.push(...problemasDeEspacios(texto, ruta));
    const yaml = leerYaml(texto, ruta, 'El anexo');
    if (yaml.ok) leidos.set(ruta, yaml.valor);
    else problemas.push(...yaml.problemas);
  }
  const cap = leidos.get('datos/capacidades.yaml');
  const tra = leidos.get('datos/transiciones.yaml');
  if (cap !== undefined && tra !== undefined) {
    const rc = esquemaCapacidades.safeParse(cap);
    const rt = esquemaTransiciones.safeParse(tra);
    if (!rc.success) {
      for (const i of rc.error.issues)
        problemas.push({ ruta: 'datos/capacidades.yaml', mensaje: `${i.path.join('.')}: ${i.message}` });
    }
    if (!rt.success) {
      for (const i of rt.error.issues)
        problemas.push({ ruta: 'datos/transiciones.yaml', mensaje: `${i.path.join('.')}: ${i.message}` });
    }
    if (rc.success && rt.success) {
      for (const m of incoherenciasTablas(rc.data, rt.data)) problemas.push({ ruta: 'datos/', mensaje: m });
    }
  }
  return problemas;
}
