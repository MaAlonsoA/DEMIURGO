---
code: FDR-AUT-001
type: fdr
title: La v2 diseña (H1)
version: 1
state: proposed
domain: gobierno
increment: H1
links:
  - type: based_on
    target: DEC-PLN-001@1
annexes: []
---

# FDR-AUT-001 · La v2 diseña (H1)

## Goal

Que la v2 pase a ser la autoridad de diseño. La v2 importa `design/` como lote pendiente, la persona lo ratifica en un paso y, desde entonces, `design/` es una exportación generada.

## Scope

- Importación de `design/` (registros, versiones, criterios, enlaces, anexos y taxonomías) como un lote pendiente del sistema, con los mismos recuentos que el origen.
- Ratificación en un paso: un comando decisivo, solo humano.
- Exportación de `design/` desde la v2, byte a byte igual al origen.
- Reimportación idempotente.
- Diseño del Pilar 2 dentro de la v2 desde H1.

## Out of scope

- La UI de ratificación: se ratifica por la API con la sesión humana.
- La construcción del Pilar 2 (S3 en adelante).
- El gate de la CI que falla si alguien edita `design/` a mano: se activa después de la ratificación, en un cambio aparte.

## Behavior

1. La importación valida `design/` con el mismo validador de la CI y crea un lote pendiente con una propuesta por elemento. Nada queda aprobado.
2. Los recuentos del lote (registros, versiones, criterios, enlaces, anexos y taxonomías) coinciden con los del origen.
3. Ratificar con un actor que no es humano da 403, sin efectos.
4. La persona ratifica el lote en un paso. Se crean los registros, las versiones, los criterios, los enlaces, los anexos y las taxonomías con los estados del origen, y la persona queda como actor de cada evento.
5. La importación conserva el estado declarado en cada archivo:
   - `propuesto` queda como versión en borrador;
   - `aprobado` queda como versión aprobada, con la persona que ratifica como actor de la aprobación.
6. La persona aprueba un documento de una de estas dos formas:
   - antes de importar, editando `estado: aprobado` en los documentos que acepta, dentro de su merge;
   - después de ratificar, aprobándolo en la v2 y regenerando `design/` con la exportación (desde H1, `design/` es generado).
7. Como la importación conserva los estados, justo después de ratificar la exportación coincide sin diff con `design/`.
8. Importar de nuevo tras ratificar no crea nada.
9. Desde aquí, el diseño nuevo nace en la v2. La primera prueba es la FDR de S3.

## Acceptance criteria

### AC-AUT-001-01 · Lote pendiente con los mismos recuentos

- Verification: automatic
- Check: Se importa `design/` y se comparan los recuentos del lote con los del origen.

Dado `design/` válido, cuando se importa, entonces se crea un lote pendiente con los mismos recuentos que el origen y nada queda aprobado.

### AC-AUT-001-02 · Solo una persona ratifica

- Verification: automatic
- Check: Se intenta ratificar el lote con cada tipo de actor no humano.

Dado el lote de importación pendiente, cuando lo ratifica un actor que no es humano, entonces recibe 403 y no hay efectos.

### AC-AUT-001-03 · Ratificar en un paso

- Verification: automatic
- Check: La persona ratifica el lote y se revisan los elementos creados y los actores de sus eventos.

Dado el lote de importación pendiente, cuando la persona lo ratifica, entonces en un solo paso se crean registros, versiones, criterios, enlaces, anexos y taxonomías con los estados declarados en el origen (`propuesto` → borrador, `aprobado` → aprobada) y la persona como actor.

### AC-AUT-001-04 · Exportación sin diff

- Verification: automatic
- Check: Se exporta tras ratificar y se compara con `design/` byte a byte.

Dada una importación ratificada, cuando se exporta, entonces el resultado coincide byte a byte con `design/`.

### AC-AUT-001-05 · Reimportar no duplica

- Verification: automatic
- Check: Se importa `design/` otra vez tras ratificar y se comparan los recuentos.

Dada una importación ratificada, cuando se importa de nuevo `design/`, entonces no se crea nada.

### AC-AUT-001-06 · Ratificación en la instancia

- Verification: manual
- Check: La persona ratifica la importación en su instancia de la v2 y revisa el resultado.

Dada la instancia de la v2 con `design/` importado, cuando la persona revisa el lote, entonces lo ratifica en un paso.

### AC-AUT-001-07 · La FDR de S3 nace en la v2

- Verification: manual
- Check: La persona revisa en la v2 la FDR de S3 y su historia.

Dada la v2 con el diseño ratificado, cuando se diseña S3, entonces su FDR se crea y se aprueba dentro de la v2, sin editar `design/` a mano.

### AC-AUT-001-08 · Edición manual bloqueada tras H1

- Verification: manual
- Check: La persona propone un cambio manual en `design/` y comprueba que la CI falla.

Dada la v2 como autoridad de diseño tras H1, cuando alguien edita `design/` a mano, entonces la CI falla porque `design/` difiere de la exportación de la v2. Queda fuera de H1 preparado: es un siguiente paso.
