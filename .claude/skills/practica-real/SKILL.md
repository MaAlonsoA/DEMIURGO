---
name: practica-real
description: Úsala siempre que propongas, escribas o revises una regla de proceso, un número, un límite, una plantilla o una práctica de desarrollo para DEMIURGO (planes, VISION.md, AGENTS.md, instrucciones de agentes, skills de producto, reglas de dominio o validaciones). Obliga a citar la fuente real de cada regla y a marcar lo que es convención nuestra.
---

# Práctica real, nunca inventada

DEMIURGO replica cómo trabaja un equipo de desarrollo de primer nivel. La persona ya encontró reglas
inventadas y presentadas como estándar («una épica tiene de 3 a 7 funcionalidades», «INVEST dice
máximo 8 criterios», «el walking skeleton es la primera tarea de cada funcionalidad»). Esta skill
existe para que no vuelva a pasar.

## Antes de proponer o escribir una regla

Para cada regla, número, límite o práctica, clasifícala en una de estas cuatro:

1. **Estándar.** La dice una fuente reconocible: libro con autor (Cockburn, Cohn, Wake, Freeman y
   Pryce, Nygard), guía oficial (Scrum Guide, SAFe, OWASP, W3C WCAG, Microsoft SDL, GitHub, IETF) o
   sistema de diseño publicado (Carbon, Primer, Atlassian). Nombra la fuente al proponerla.
2. **Convención nuestra dentro de un estándar.** El estándar deja que cada equipo lo decida (p. ej.
   el contenido de la Definition of Ready o de la Definition of Done en Scrum). Dilo así: «convención
   nuestra, permitida por …».
3. **Decisión de la persona.** La tomó ella, aunque se aparte del estándar (p. ej. fusionar solo con
   CI en verde). Dilo así y, si se aparta, di en qué.
4. **Sin fuente.** No la presentes como estándar. Pregunta a la persona o quítala.

Reglas:

- **Ningún número sin fuente.** Un límite plausible pero sin fuente es invención. Si hace falta un
  número y el estándar no lo da, se propone como convención con su motivo y lo decide la persona.
- **Compruébalo en internet.** Toda regla que vayas a presentar como estándar se verifica con
  WebSearch/WebFetch contra la fuente primaria (el libro, la guía oficial, la documentación), salvo
  que ya se verificara en esta misma sesión. Da el enlace a la persona. Lo que no puedas verificar
  se dice así: «sin comprobar».
- **No atribuyas a una fuente lo que no dice.**
- **Aplica cada práctica en su ámbito.** El walking skeleton es del inicio del proyecto, no de cada
  funcionalidad; INVEST describe historias, no fija cuántos criterios tienen.
- **Al dar opciones**, cada opción lleva su fuente o la marca de convención.
- **Al escribir en VISION.md**, cada práctica del apartado de prácticas lleva su fuente entre
  paréntesis. Las convenciones nuestras se marcan como tales.

## Antes de entregar un plan o un cambio de proceso

Repasa el texto buscando números, límites y verbos como «siempre», «nunca», «como mucho», «debe». Para
cada uno, la clasificación de arriba. Si el plan es grande o toca varias reglas, lanza un subagente
que lo audite contra fuentes (en modo refutar) antes de enseñárselo a la persona.
