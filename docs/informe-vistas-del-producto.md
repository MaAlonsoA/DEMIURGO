# Informe: vistas del producto, mapa y recorridos (FDR-INT-002)

Fecha: 25-09-2026, durante la noche. Rama `v2-vistas`, que sale de `v2-agentes` e incluye todo lo de agentes y proveedores. Está en el worktree `D:\Dev\Demiurgo-agentes`. No se ha subido ni fusionado nada.

Documentos relacionados:
- **Spec:** `docs/superpowers/specs/2026-09-25-mapa-y-recorridos-design.md`, con las decisiones que tomé yo.
- **FDR:** `design/fdr/FDR-INT-002.md`, con 8 criterios automáticos y `increment: H1`.

## 1. Qué hay

Pediste «implementar los slices pendientes, tanto front como back, como los mapas, árboles, etc.». Del paso 2 del canvas faltaban dos de las cuatro vistas del producto. **Origins**, el árbol de procedencia, ya existía. Las pestañas de *Product* pasan a ser **Overview · Map · Origins · Journeys**.

**Map** (canvas S2A, S3D y S3H):
- Hay una columna por área, tomada del dominio de cada registro. Van de la que tiene más funcionalidades a la que menos.
- Las funcionalidades son tarjetas, con su marca y sus barras. Debajo van las decisiones y decisiones técnicas como reglas («Rules it follows»).
- Las líneas salen solo de los enlaces que existen, con su tipo:
  - *needs*: de una funcionalidad a otra;
  - *rule it follows*: hacia una decisión o una decisión técnica;
  - *conflicts*: en óxido;
  - *affects*: discontinua.

  Un enlace pendiente de revisión también se dibuja discontinuo.
- Al señalar un elemento se iluminan sus conexiones y se atenúa el resto. Al elegirlo, el panel muestra:
  - de dónde viene;
  - las reglas que sigue;
  - qué lo necesita;
  - las preguntas abiertas de su hilo, con **Answer**;
  - sus checks.
- Tiene zoom (−, +, Fit) que conserva la selección, se usa con el teclado y muestra las ideas aparcadas abajo.

**Journeys** (canvas S2C):
- Hay un recorrido por funcionalidad con *Behavior*. Sale de su versión vigente o, si no la hay, de la última.
- **Pasos:** los puntos numerados del *Behavior*, en orden.
- **Caminos:** sus criterios, con «Dado…, cuando…, entonces…» mostrado como «If … / When … / → …».
- **Huecos:** las preguntas abiertas del hilo del que viene la funcionalidad, marcadas «Not defined yet» y con **Answer**.
- Abajo, un resumen: caminos, definidos, los que esperan a la persona y pasos.

**Lo que conecta con un registro:**
- En la página de un registro, «What it touches» muestra ahora también los enlaces que llegan de otros: «Needed by», «Followed by», «Conflicts with» y «Affected by».
- Solo cuentan los de la versión mostrada de cada uno, así que lo que una versión nueva dejó de enlazar ya no aparece.
- Cubre un hueco del informe de H1: «el detalle de un registro no trae los enlaces entrantes».

**Back:**
- `GET /api/projects/:id/map` y `GET /api/projects/:id/journeys`, una llamada por vista y con permiso `query.records`.
- `incoming` en el detalle de un registro.
- El análisis del texto es puro y va en `packages/domain/src/views.ts` (`behaviorSteps`, `criterionPath`, `relationOf` y `areaOrder`).

Capturas: `reports/screens/corte-10/map.png` y `journeys.png`.

## 2. Decisiones que tomé

Cada decisión va con lo que cuesta si me equivoqué.

1. **Áreas = dominio del registro,** no la taxonomía del conocimiento. El dominio siempre existe; la taxonomía solo si se aprobó y el clasificador corrió. *Coste:* si prefieres las áreas de la taxonomía, es cambiar la consulta.
2. **Solo relaciones de enlaces reales,** nada inferido. *Coste:* el mapa puede verse poco conectado donde faltan enlaces.
3. **Recorridos deterministas, sacados de lo escrito.** No hay agente que los proponga; eso queda para S6. *Coste:* una funcionalidad sin *Behavior* numerado no tiene pasos útiles.
4. **Propósito, quién lo usa y reglas del producto siguen como «Later»,** porque son entidades de S6 que el back no tiene.
5. **FDR-INT-002 con `increment: H1`,** porque todos sus criterios tienen prueba. *Coste:* si no lo quieres en H1, es quitar la línea.
6. **No toqué nada más de la web existente,** salvo una línea en el panel de contexto, las pestañas y el router. Hay otra sesión migrando la web al design system (ver la sección 4).
7. **No usé DesignSync para leer el canvas.** Es solo para la skill `/design-sync`, que arranca la persona. Me guie por `docs/diseno-ux-2026-09-24.md`.

## 3. Estado de las pruebas

Rama `v2-vistas` completa, con agentes y proveedores incluidos:
- `gate:test`: 674/674;
- `gate:invariants`: 502/502;
- e2e: 83/83;
- trazabilidad: 121 criterios y 1259 pruebas;
- tipos, lint, formato, `design/` y deriva, limpios.

## 4. Para fusionar

En `D:\Dev\Demiurgo` (rama `v2-frontend-h1`) hay otra sesión con la migración de la web al design system `@demiurgo/design-system` sin commit: 92 ficheros y `packages/design-system/` nuevo. Por eso no he fusionado nada. Cuando ese trabajo esté commiteado:

```
git merge v2-vistas      # desde v2-frontend-h1; trae también v2-agentes
```

Conflictos que espero, todos pequeños:
- el router;
- las pestañas de `Header.tsx`;
- `Reasons.tsx`, `NewProject.tsx` y `Projects.tsx` (por Models & providers);
- `RecordAside.tsx` y `Record.tsx` (una línea cada uno);
- `stream.ts` y las pantallas de ejecución.

**Map** y **Journeys** son pantallas nuevas hechas con los tokens y componentes actuales de `packages/web/src/ui`. Tendrán que pasar a las clases `dm-*` y a los componentes del design system como las demás.
