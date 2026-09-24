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

Cada archivo se llama \`<código>.md\` y contiene la versión vigente de su registro.

## Formato fijo

1. **Frontmatter YAML** con, en este orden: \`codigo\`, \`tipo\`, \`titulo\`, \`version\`, \`estado\` (\`propuesto\`, \`aprobado\`, \`sustituido\` o \`descartado\`), \`dominio\`, \`incremento\` (opcional), \`nota_de_cambio\` (opcional), \`enlaces\` (lista de \`tipo\` y \`destino: CODIGO@version\`) y \`anexos\`.
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

Enunciado observable (Dado…, cuando…, entonces…).
\`\`\`

Un criterio automático tiene al menos una prueba cuyo nombre empieza por su código.

## Reglas que comprueba el validador

- El archivo es canónico: volver a escribirlo desde su contenido no cambia ni un byte (LF, sin espacios al final de línea ni líneas en blanco de más).
- Los códigos de registros, taxonomías y criterios son únicos.
- Los enlaces apuntan a registros existentes y a versiones que existen.
- Los anexos existen y sus tablas son coherentes entre sí.
- Cada eje de una taxonomía tiene la categoría \`otra\`.

Ejecuta \`pnpm gate:design\` para validar y \`node packages/design/src/cli.ts canonizar\` para reescribir los archivos en formato canónico.
`;
