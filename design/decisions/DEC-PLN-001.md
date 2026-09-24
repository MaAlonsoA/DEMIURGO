---
code: DEC-PLN-001
type: decision
title: Reimplementar DEMIURGO como v2
version: 1
state: proposed
domain: plataforma
links: []
annexes: []
---

# DEC-PLN-001 · Reimplementar DEMIURGO como v2

## Context

La auditoría del 24-09-2026 (`docs/analisis-vision-mvp-2026-09-24.md`) muestra que la v1 creció en horizontal. Ninguna parte usaba de verdad los AC, las versiones ni la readiness. Aprobar creaba una versión nueva, los gates se podían saltar, el cliente declaraba el actor y una heurística aceptaba propuestas de IA sin la persona.

El plan de reimplementación (`docs/plan-reimplementacion-2026-09-24.md`) comparó tres enfoques con tres jueces independientes. Ganó el esqueleto andante: una franja fina pero completa de los dos pilares desde el principio.

## Decision

- DEMIURGO se reimplementa desde cero como v2, en la rama `v2` de este repositorio, según el plan del 24-09-2026.
- La v1 queda descartada. No se arregla ni se reutiliza: solo es un catálogo de lecciones que se consulta con `git show v1-referencia:<ruta>`.
- Hasta H1, el diseño vive en `design/` con formato fijo y la persona lo aprueba con el merge. En H1, la v2 lo importa y pasa a ser la autoridad de diseño.
- Primero se construye un esqueleto andante de los dos pilares (diseñar y construir) sobre un núcleo en el que ningún agente decide ni produce evidencia.
- Orden de los incrementos: D0 → S0–S2 → H1 → S3–S5 → H2 → S6–S8.

## Consequences

- Todo lo que se diseña para la v2 sale del plan y de sus principios (§2), no del código de la v1.
- La v1 deja de recibir cambios. Su instancia estable (`demiurgo-stable`, puerto 8000) no se toca.
- Hasta H1 hay una sola autoridad de diseño: los archivos de `design/` que fusiona la persona.
- Si el tiempo se agota, se aplica el MVP de repliegue del plan: se recortan funcionalidades, nunca invariantes.
