---
codigo: ADR-FMT-001
tipo: adr
titulo: Formato fijo de design/ y validador
version: 1
estado: propuesto
dominio: diseno
incremento: D0
enlaces:
  - tipo: based_on
    destino: DEC-PLN-001@1
anexos: []
---

# ADR-FMT-001 · Formato fijo de design/ y validador

## Contexto

Hasta H1 no hay ninguna aplicación donde diseñar: el diseño empieza como archivos del repositorio (§6 del plan). En H1, la v2 los importa como lote pendiente y, desde entonces, `design/` es una exportación generada. Para eso hacen falta tres cosas:

- un formato que la v2 pueda importar sin ambigüedad;
- una exportación que reproduzca `design/` sin diff;
- un validador en la CI que compruebe el formato, que los códigos sean únicos, que cada AC tenga verificación y que los enlaces existan.

Riesgos que cubre: que el diseño en Markdown se quede corto antes de que exista la aplicación, y la doble fuente de verdad entre D0 y H1.

## Opciones

- **Markdown con frontmatter YAML y formato fijo.** Se lee y se revisa bien en un PR, el diff es claro y se puede importar y exportar.
- **YAML o JSON puro.** Fácil de validar, pero incómodo para leer y revisar prosa.
- **Formato de terceros (OpenSpec, Spec Kit).** Cambian cada mes. Quedan como destino de exportación, no como formato propio.
- **Markdown libre.** No se puede importar sin ambigüedad ni exportar sin diff.

## Decisión

- Markdown con frontmatter YAML. Un archivo por registro (`<código>.md`) en una carpeta por tipo. Las tablas como datos viven en `datos/`, cada una anexa a un solo registro.
- Frontmatter en orden fijo, cuerpo con la plantilla de su tipo y `## Criterios de aceptación` siempre al final, con formato fijo por criterio. El formato completo está en `design/README.md`, que se genera desde `packages/design/src/readme.ts`.
- **Regla canónica:** un documento es válido solo si `renderizar(parsear(x)) = x`. No hay variantes de estilo y la exportación de H1 sale sin diff.
- El validador es `pnpm gate:design`. Las etapas de la CI ejecutan, entre todas, cada gate de `pnpm gate:all`, incluidos `gate:design` y `gate:trazabilidad`. `node packages/design/src/cli.ts canonizar` reescribe los archivos en forma canónica.
- **Trazabilidad AC → prueba por código:** cada criterio automático de un incremento implementado tiene al menos una prueba que pasa y cuyo título empieza por su código. `pnpm gate:trazabilidad` lo calcula con los informes JUnit de Vitest (`reports/junit-*.xml`), así que solo cuenta lo que se ejecutó y pasó: un comentario, una cadena, un `describe` o una prueba saltada o fallida no cuentan. Los incrementos implementados se declaran en `package.json`, en `demiurgo.incrementosImplementados`.
- Todos los documentos entran en estado «propuesto»: la persona los aprueba con el merge.

## Consecuencias

- El formato es estrecho a propósito: lo que no cabe en la plantilla no se escribe.
- El importador y el exportador de H1 comparten el parser y el renderizador de `packages/design`.
- Una prueba pasada que cita un código inexistente, o un AC automático sin prueba pasada, hace fallar `gate:trazabilidad`.
- La trazabilidad por nombre es provisional. En S3 la sustituye el mapa AC → comprobación → prueba que acepta la persona.
- Desde H1, `design/` es una exportación y la CI fallará si alguien lo edita a mano.

## Criterios de aceptación

### AC-FMT-001-01 · Documento canónico

- Verificación: automática
- Comprobación: El validador reescribe cada documento desde su contenido y compara los bytes.

Dado un documento de `design/`, cuando se reescribe desde su contenido, entonces produce exactamente los mismos bytes; un documento con CRLF, espacios finales de cualquier tipo, más de una línea en blanco seguida o una sección vacía o repetida se rechaza, y un anexo con CRLF o espacios finales también.

### AC-FMT-001-02 · Códigos y enlaces

- Verificación: automática
- Comprobación: El validador revisa los códigos, los enlaces y los anexos de todo el árbol.

Dado el árbol `design/`, cuando se valida, entonces los códigos de registros, taxonomías y criterios son únicos y la parte DOM-NNN de un registro no se repite entre tipos; cada enlace apunta a la versión vigente de un registro que existe y no se repite; y cada anexo existe, es YAML válido y pertenece a un solo registro.

### AC-FMT-001-03 · Criterios verificables

- Verificación: automática
- Comprobación: El validador revisa cada criterio y el número de criterios de cada registro.

Dado un criterio de aceptación, cuando se valida, entonces tiene verificación automática o manual, comprobación y enunciado, su código empieza por el del registro y su «Deriva de», si lo tiene, apunta a un criterio que existe; un encabezado fuera de «Criterios de aceptación» que empieza por un código de criterio se rechaza, y también un ADR, una FDR o un bug sin criterios.

### AC-FMT-001-04 · Taxonomía con «otra»

- Verificación: automática
- Comprobación: El validador revisa los ejes de cada taxonomía.

Dada una taxonomía, cuando se valida, entonces cada eje tiene la categoría `otra`; un eje sin ella se rechaza.

### AC-FMT-001-05 · Trazabilidad

- Verificación: automática
- Comprobación: Se calcula el mapa AC → prueba con los informes JUnit de las pruebas ejecutadas.

Dado un incremento implementado, cuando se calcula el mapa AC → prueba con los informes JUnit, entonces cada criterio automático tiene al menos una prueba que pasó y cuyo título empieza por su código; una prueba fallida o saltada, o un código en un `describe` o en medio del título, no cuenta; y una prueba pasada que cita un código inexistente hace fallar el gate.

### AC-FMT-001-06 · Gates en la CI

- Verificación: automática
- Comprobación: Se revisan el workflow de GitHub Actions y el script `gate:all`.

Dado el workflow de la CI, cuando se ejecuta, entonces sus etapas ejecutan, entre todas, cada gate de `pnpm gate:all`, incluidos `gate:design` y `gate:trazabilidad`.

### AC-FMT-001-07 · Aceptación humana

- Verificación: manual
- Comprobación: La persona revisa el ADR y lo fusiona en `main`.

Dado este ADR en estado propuesto, cuando la persona lo revisa, entonces lo acepta con el merge.
