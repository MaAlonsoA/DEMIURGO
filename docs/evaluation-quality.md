# Evaluación de calidad y gate de release

Ejecuta la batería automática antes de actualizar la instancia estable. Repite la evaluación manual con Codex real en una base temporal, con prompts y configuración de modelo documentados.

## Escenarios manuales

1. Importa `VISION.md`, revisa propuestas y confirma que cada decisión aceptada permite rastrear el texto fuente y la propuesta de origen.
2. Explora la asociación, crea dos FDR, y liga a cada una criterios observables y tareas incluidas en un Change Set.
3. Cambia los socios admitidos para incluir invitados. Revisa historia, relaciones y tareas/Change Sets posiblemente afectados; deja explícita la revisión de cada relación.
4. Interrumpe Codex durante una respuesta y reintenta. Confirma que el mensaje original persiste y que no se duplica ni pierde al reintentar.
5. Exporta contexto e impórtalo en otra instancia. Confirma que conserva diseño y procedencia, pero no hereda tareas, Change Sets ni evidencias.

## Puntuación

Puntúa cada escenario de 1 a 5 en estos aspectos: exactitud y procedencia; separación entre preguntas y acuerdos; utilidad de propuestas; claridad del impacto; comprobación del trabajo. Registra el commit, tag/versión, versión de Codex CLI, modelo y configuración, puntuaciones por escenario, media y problemas observados.

Parte de [`docs/evaluations/TEMPLATE.md`](evaluations/TEMPLATE.md) y guarda el resultado en `docs/evaluations/vN.0.0.md`, con datos sintéticos y sin credenciales ni bases de trabajo.

## Gate

La release puede proponerse para promoción cuando pasan todas las comprobaciones automáticas, la media humana es al menos 4/5, ningún escenario crítico queda por debajo de 3/5, y no hay fallos críticos de trazabilidad, confirmación humana o integridad de datos. La decisión de promover corresponde al responsable del producto.

Para comparar dos versiones, ejecuta los mismos escenarios, prompts y configuración en bases temporales y registra la imagen usada en cada evaluación.
