// Fixed text of `design/README.md`. The v2's export writes it as is.

export const README_DESIGN = `# design/: el diseño de DEMIURGO v2

Esta carpeta es la autoridad de diseño **hasta H1**: la persona aprueba los cambios con el merge. Desde H1, la v2 la importa, la persona ratifica la importación en un paso y \`design/\` pasa a ser una exportación generada.

## Estructura

| Carpeta | Contenido | Código |
|---|---|---|
| \`decisions/\` | Decisiones | \`DEC-DOM-NNN\` |
| \`adr/\` | Decisiones de arquitectura | \`ADR-DOM-NNN\` |
| \`fdr/\` | Diseños de funcionalidad | \`FDR-DOM-NNN\` |
| \`bugs/\` | Registros de bug | \`BUG-DOM-NNN\` |
| \`taxonomy/\` | Taxonomías del conocimiento | \`TAX-NNN\` |
| \`data/\` | Tablas como datos, anexas a un registro | \`DAT-XXX-NNN\` |

Cada archivo se llama \`<código>.md\` y contiene la versión en curso de su registro: la última que no se ha descartado.

## Formato fijo

1. **Frontmatter YAML** con, en este orden: \`code\`, \`type\`, \`title\`, \`version\` (desde 1), \`state\` (\`proposed\` o \`approved\`), \`domain\`, \`increment\` (opcional), \`change_note\` (opcional), \`links\` (lista de \`type\` y \`target: CODE@version\`, con la versión de destino que está en \`design/\` o una anterior que ya esté en la v2) y \`annexes\`.
2. **Título**: \`# <código> · <título>\`.
3. **Secciones** \`## \` con la plantilla de su tipo, en orden:
   - decisión: Context, Decision, Consequences;
   - ADR: Context, Options, Decision, Consequences;
   - FDR: Goal, Scope, Out of scope, Behavior;
   - bug: Reproduction, Expected, Observed.
4. **Acceptance criteria** (obligatorios en ADR, FDR y bug), siempre la última sección. Cada criterio:

\`\`\`
### AC-DOM-NNN-NN · Título corto

- Verification: automatic | manual
- Check: cómo se comprueba, en lenguaje de producto.
- Derived from: AC-DOM-NNN-NN (opcional)

Enunciado observable (Dado…, cuando…, entonces…).
\`\`\`

Un criterio automático de un incremento implementado tiene al menos una prueba que pasa y cuyo título empieza por su código (uno o varios códigos seguidos). \`pnpm gate:traceability\` lo comprueba con los informes JUnit de \`pnpm gate:test\` y \`pnpm gate:invariants\`.

## Reglas que comprueba el validador

- El archivo es canónico: volver a escribirlo desde su contenido no cambia ni un byte. Además usa LF, no tiene espacios en blanco de ningún tipo al final de línea ni varias líneas en blanco seguidas.
- Los códigos de registros, taxonomías y criterios son únicos, y la parte \`DOM-NNN\` de un registro no se repite entre tipos.
- Ninguna sección se repite y ningún encabezado fuera de «Acceptance criteria» empieza por un código de criterio.
- Los enlaces apuntan a la versión vigente de un registro existente y no se repiten. \`Derived from\` apunta a un criterio existente.
- Los anexos existen, son YAML válido con LF y sin espacios finales, pertenecen a un solo registro y sus tablas son coherentes entre sí.
- Cada eje de una taxonomía tiene la categoría \`other\`.

Ejecuta \`pnpm gate:design\` para validar y \`node packages/design/src/cli.ts canonicalize\` para reescribir los archivos en formato canónico: también quita los CRLF, los espacios finales y las líneas en blanco de más.
`;
