# DEMIURGO v2

DEMIURGO guía el desarrollo de software con IA de principio a fin: primero se diseña, de la intención a «Listo para construir», y luego se construye de forma gobernada. Los modelos proponen, el sistema dispone con reglas deterministas y la persona decide.

Esta rama contiene la v2 hasta la preparación del Hito 1 (H1), solo el backend:

- **D0**: el diseño en `design/` (formato fijo con validador, ADR, FDR, taxonomía y las tablas de capacidades y transiciones como datos).
- **S0**: el esqueleto técnico (bus de comandos, diario protegido, motor durable, agentes, runner aislado).
- **S1**: el Pilar 1 hasta «Listo para construir», con canal de agentes por API y MCP.
- **S2**: el motor de conocimiento y contexto.
- **H1 preparado**: importación de `design/` como lote pendiente y exportación sin diff.

Documentos clave: el plan (`docs/plan-reimplementacion-2026-09-24.md`), el stack (`docs/investigacion-stack-2026-09-24.md`) y el informe de esta fase (`docs/informe-autonomo-v2-h1.md`), con cómo arrancar y probar todo.

```powershell
pnpm install
pnpm db:up
pnpm gate:all
```

La v1 queda en la etiqueta local `v1-referencia` solo como referencia.
