// Texto fijo de `design/README.md`. La exportación de la v2 lo escribe tal cual.

export const README_DISENO = `# design/: el diseño de DEMIURGO v2

Esta carpeta es la autoridad de diseño **hasta H1**: la persona aprueba los cambios con el merge. Desde H1, la v2 la importa, la persona ratifica la importación en un paso y \`design/\` pasa a ser una exportación generada.

## Estructura

| Carpeta | Contenido | Código |
|---|---|---|
| \`decisiones/\` | Decisiones | \`DEC-DOM-NNN\` |
| \`adr/\` | Decisiones de arquitectura | \`ADR-DOM-NNN\` |
| \`fdr/\` | Diseños de funcionalidad | \`FDR-DOM-NNN\` |
| \`bugs/\` | Registros de bug | \`BUG-DOM-NNN\` |
| \`taxonomia/\` | Taxonomías del conocimiento | \`TAX-NNN\` |
| \`datos/\` | Tablas como datos, anexas a un registro | \`DAT-XXX-NNN\` |

Cada archivo se llama \`<código>.md\` y contiene la versión en curso de su registro: la última que no se ha descartado.

## Formato fijo

1. **Frontmatter YAML** con, en este orden: \`codigo\`, \`tipo\`, \`titulo\`, \`version\` (desde 1), \`estado\` (\`propuesto\` o \`aprobado\`), \`dominio\`, \`incremento\` (opcional), \`nota_de_cambio\` (opcional), \`enlaces\` (lista de \`tipo\` y \`destino: CODIGO@version\`, con la versión de destino que está en \`design/\` o una anterior que ya esté en la v2) y \`anexos\`.
2. **Título**: \`# <código> · <título>\`.
3. **Secciones** \`## \` con la plantilla de su tipo, en orden:
   - decisión: Contexto, Decisión, Consecuencias;
   - ADR: Contexto, Opciones, Decisión, Consecuencias;
   - FDR: Objetivo, Alcance, Fuera de alcance, Comportamiento;
   - bug: Reproducción, Esperado, Observado.
4. **Criterios de aceptación** (obligatorios en ADR, FDR y bug), siempre la última sección. Cada criterio:

\`\`\`
### AC-DOM-NNN-NN · Título corto

- Verificación: automática | manual
- Comprobación: cómo se comprueba, en lenguaje de producto.
- Deriva de: AC-DOM-NNN-NN (opcional)

Enunciado observable (Dado…, cuando…, entonces…).
\`\`\`

Un criterio automático de un incremento implementado tiene al menos una prueba que pasa y cuyo título empieza por su código (uno o varios códigos seguidos). \`pnpm gate:trazabilidad\` lo comprueba con los informes JUnit de \`pnpm gate:test\` y \`pnpm gate:invariantes\`.

## Reglas que comprueba el validador

- El archivo es canónico: volver a escribirlo desde su contenido no cambia ni un byte. Además usa LF, no tiene espacios en blanco de ningún tipo al final de línea ni varias líneas en blanco seguidas.
- Los códigos de registros, taxonomías y criterios son únicos, y la parte \`DOM-NNN\` de un registro no se repite entre tipos.
- Ninguna sección se repite y ningún encabezado fuera de «Criterios de aceptación» empieza por un código de criterio.
- Los enlaces apuntan a la versión vigente de un registro existente y no se repiten. \`Deriva de\` apunta a un criterio existente.
- Los anexos existen, son YAML válido con LF y sin espacios finales, pertenecen a un solo registro y sus tablas son coherentes entre sí.
- Cada eje de una taxonomía tiene la categoría \`otra\`.

Ejecuta \`pnpm gate:design\` para validar y \`node packages/design/src/cli.ts canonizar\` para reescribir los archivos en formato canónico: también quita los CRLF, los espacios finales y las líneas en blanco de más.
`;
