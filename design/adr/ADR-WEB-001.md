---
code: ADR-WEB-001
type: adr
title: Interfaz web de la v2
version: 1
state: proposed
domain: interfaz
links:
  - type: based_on
    target: DEC-PLN-001@1
annexes: []
---

# ADR-WEB-001 · Interfaz web de la v2

## Context

Hasta H1 la v2 no tiene interfaz: la aceptación humana se hace por la API con la cookie de sesión. H1 exige que la FDR de S3 nazca y se apruebe en la v2 con la persona en la UI. ADR-STK-001 fija TypeScript de extremo a extremo, pero no dice nada del frontend.

La API ya da lo que la UI necesita:
- sesión con cookie httpOnly y SameSite=Strict, más la cabecera `x-demiurgo-csrf` en cada mutación;
- una sola vía de escritura, `POST /api/projects/:projectId/commands/:command`;
- las tablas de capacidades y transiciones como datos (`GET /api/commands` y `GET /api/tables`);
- las consultas y el flujo SSE del diario con Last-Event-ID.

La experiencia se diseñó con la persona en Claude Design (`docs/diseno-ux-2026-09-24.md`): interfaz en inglés, escritorio primero y un lenguaje visual común.

## Options

- **SPA con React, Vite y TanStack (Router y Query), Tailwind 4 y shadcn/ui.** Rutas tipadas y caché de consultas que se invalida con el SSE. Componentes accesibles sobre Radix, copiados al repositorio. El mayor ecosistema, y el diseño del canvas se traduce casi directo. Añade un paso de build solo en el paquete web.
- **React Router 8 en modo SPA.** Es uno de los candidatos a plantilla de las apps que generará DEMIURGO. Pero esa elección está pendiente para S3, con sus propias evaluaciones, y se adelantaría.
- **Next.js.** Añade SSR y un segundo servidor que no hacen falta, y choca con la API única en Fastify y con la cookie de mismo origen.

## Decision

- Paquete nuevo `packages/web`: una SPA en React y TypeScript construida con Vite. Es el único paquete con paso de build; el resto sigue con type stripping.
- **Rutas:** TanStack Router. **Datos:** TanStack Query, con una consulta por cada consulta de la API. El flujo `GET /api/projects/:projectId/events/stream`, con Last-Event-ID, invalida las consultas que afecta cada evento.
- **Estilos:** Tailwind 4 con los tokens semánticos del diseño: tinta, papel, azul solo para «Needs you», ámbar para trabajo en curso, óxido para problemas y gris para lo inactivo. **Componentes:** shadcn/ui sobre Radix, por la accesibilidad.
- **Mismo origen:**
  - en desarrollo, Vite hace de proxy de `/api` hacia la API;
  - en producción, la API sirve el build desde el mismo origen;
  - la cookie sigue siendo SameSite=Strict y cada mutación lleva `x-demiurgo-csrf`.
- **La UI nunca decide lo que está permitido.** Las acciones disponibles salen de `GET /api/commands` y `GET /api/tables`; la UI solo las pone en palabras. Escribe únicamente con `POST /api/projects/:projectId/commands/:command`.
- **Textos de la interfaz en inglés,** en un único diccionario indexado por los códigos de estado y de comando, sin framework de i18n por ahora. El contenido de los registros se muestra tal como se escribió.
- **Pruebas:**
  - componentes con Vitest;
  - recorridos de extremo a extremo con Playwright y axe contra la API con el simulador;
  - el título de cada prueba empieza por el código de su AC, como en el resto del repositorio.
- **Dependencias:** versiones exactas y la antigüedad mínima de publicación que ya exige pnpm.

## Consequences

- Aparece un paso de build, solo en `packages/web`. La CI lo construye y ejecuta Playwright, que necesita navegadores.
- Crecen las dependencias (React, Radix, Tailwind); la auditoría de dependencias de S8 las cubrirá.
- La API gana una ruta para servir el build.
- La elección de la plantilla de las apps generadas (React Router 8 frente a Next.js, en S3) sigue siendo independiente.
- Escritorio primero: el ancho mínimo es 1280 px y el móvil queda fuera.

## Acceptance criteria

### AC-WEB-001-01 · Mismo origen y CSRF

- Verification: automatic
- Check: Un E2E con Playwright entra con una persona de prueba y ejecuta un comando desde la UI; otra prueba repite la petición sin la cabecera.

Dada la UI servida por la API, cuando la persona entra y ejecuta un comando, entonces la petición va al mismo origen con la cookie de sesión y la cabecera `x-demiurgo-csrf`, y la misma petición sin la cabecera recibe 403.

### AC-WEB-001-02 · Acciones desde las tablas

- Verification: automatic
- Check: Una prueba de componentes calcula las acciones de un elemento con tablas de prueba y quita una transición.

Dado un elemento en un estado, cuando la UI muestra sus acciones, entonces solo ofrece los comandos que las tablas permiten desde ese estado a una persona, y al quitar esa transición de la tabla el botón desaparece.

### AC-WEB-001-03 · Accesibilidad básica

- Verification: automatic
- Check: axe se ejecuta en cada pantalla del recorrido de H1 y el recorrido se repite solo con teclado.

Dada cada pantalla del recorrido de H1, cuando se analiza con axe, entonces no aparece ninguna violación seria ni crítica, y el recorrido completo se puede hacer solo con el teclado.

### AC-WEB-001-04 · Aceptación humana

- Verification: manual
- Check: La persona revisa el ADR y lo acepta.

Dado este ADR en estado propuesto, cuando la persona lo revisa, entonces lo acepta.
