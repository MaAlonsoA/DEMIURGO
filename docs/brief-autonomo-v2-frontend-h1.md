# Brief de la sesión autónoma: frontend de H1

Fecha: 24-09-2026. Encargo: implementar el frontend completo de H1 de DEMIURGO v2 (cortes 0 a 7 del spec), con TDD, gates en verde y un informe final. La sesión trabaja de forma autónoma y solo se para en los casos de la sección 7.

## 1. Lee primero

1. `AGENTS.md` y `CLAUDE.md`: reglas, idioma y comandos.
2. `docs/superpowers/specs/2026-09-24-interfaz-h1-design.md`: el spec. Pantallas, rutas, componentes, palabras de la UI, tiempo real, pruebas y cortes.
3. `design/fdr/FDR-INT-001.md` y `design/adr/ADR-WEB-001.md`: qué hace la interfaz y con qué stack. Sus AC son la definición de hecho.
4. `docs/diseno-ux-2026-09-24.md`: el lenguaje visual acordado y su porqué (secciones 4 a 7 y 9).
5. `docs/ux/canvas/`: los tableros del canvas. De ahí salen las medidas, los colores, los SVG de las marcas, la anatomía de las tarjetas y los textos. Son una referencia en HTML con estilos en línea, no código para copiar.
6. `docs/informe-autonomo-v2-h1.md` §9: el contrato del back. Si no coincide con el código de `packages/api` o `packages/core`, manda el código.

## 2. Antes de empezar

- Comprueba que `pnpm gate:all` pasa en `v2`. Si no pasa, para y avisa.
- Si hay otra sesión trabajando en el repo (árbol sucio o commits `wip` recientes), trabaja en un worktree propio: `git worktree add ../Demiurgo-frontend -b v2-frontend-h1 v2`. Si no la hay, crea la rama `v2-frontend-h1` desde `v2`.
- Sin push. Nunca `main`.

## 3. Reglas, además de las de AGENTS.md

- **Entorno:**
  - Prohibido tocar el proyecto compose `demiurgo-stable`, `%LOCALAPPDATA%\Demiurgo\stable` y el puerto 8000.
  - Tampoco se toca la instancia real `demiurgo-v2` (Postgres `127.0.0.1:55433`, API 8100) ni su lote pendiente. **Nunca se ratifica ni se ejecutan comandos decisivos allí:** ratificar le corresponde a la persona.
  - Se trabaja con la base de desarrollo (`pnpm db:up`, 55432) y con las bases efímeras de las pruebas. La API de desarrollo se levanta en otro puerto, por ejemplo 8200.
- **Agentes:** solo el agente y el clasificador simulados. Nada de ejecuciones reales con Claude: consumen la cuota de la persona.
- **Idioma:** el código, los textos de la UI, los títulos de las pruebas y los mensajes van en inglés. Los commits, el informe y la documentación, en español.
- **Commits:**
  - Pequeños, con la skill `commit`, cada uno con `pnpm gate:all` en verde.
  - Nunca se debilitan, borran ni saltan pruebas existentes, ni se cambia el texto de un AC para que encaje.
- **`design/`:**
  - No se edita, salvo para añadir `increment: H1` a ADR-WEB-001 y FDR-INT-001 al final (sección 8).
  - `design/data/` no se toca.
- **Dependencias:**
  - Versiones exactas, respetando el `minimumReleaseAge` de pnpm: si una versión es demasiado nueva, se usa la anterior.
  - Cualquier dependencia fuera del stack de ADR-WEB-001 se anota en el informe.

## 4. Cambios permitidos en el back (solo estos)

La API no tiene todo lo que usa el spec. Se puede añadir lo siguiente, en inglés y con sus pruebas:

1. Servir el build de `packages/web` desde la API con `@fastify/static`. Toda ruta que no empiece por `/api` devuelve `index.html`.
2. Consultas de solo lectura que reutilicen los nombres de consulta que ya existen en la matriz (`query.knowledge`, `query.runs`, `query.batches` y `query.records`), para no tocar `design/data/`:
   - `GET …/knowledge/graph`: nodos y aristas vigentes, con su tipo, su referencia, su estado epistémico y su área de la taxonomía según su clasificación.
   - `GET …/knowledge/idea-assessments`: evaluaciones de ideas, con su veredicto y el nodo o registro citado.
   - `GET …/taxonomies`: taxonomías, con su estado y su contenido.
   - `GET …/runs`: lista de ejecuciones, con estado, acción, exploración, modelo, de cuál es reintento y fechas.
   - En el detalle de un lote de importación, los recuentos del origen como dato estructurado. Hoy solo están en el texto del lote y en su evento.

**Cualquier otro cambio en el back no se hace:** comandos, tablas, guardas, reglas de autoridad o esquema. Se anota en el informe como pendiente y la pantalla se adapta a lo que hay.

## 5. Correcciones al spec (mandan sobre él)

- «Accept and approve» existe: `batch.accept_package` y `proposal.accept` admiten `{ "approve": true }`. Se ofrece siempre.
- Las fuentes solo tienen `name`, `content_hash`, `registered_by` y `created_at`: no hay URL ni tipo.
- Cada ejecución guarda `model`, y la marca de DEMIURGO lo muestra.
- La página de conocimiento y Activity usan las consultas nuevas de la sección 4.
- Las rutas y los campos de la API son los del código actual, en inglés, no los del informe de H1.

## 6. Cómo trabajar

- **Cortes:** en el orden de la sección 10 del spec, del 0 al 7. El corte 8 (ratificar la instancia real y diseñar S3 dentro) es de la persona: no se hace.
- **TDD por AC:**
  - Primero la prueba, con un título que empiece por su código (`AC-INT-001-NN …` o `AC-WEB-001-NN …`); después el código.
  - Playwright con `@axe-core/playwright` y reporter JUnit hacia `reports/junit-e2e.xml`. La trazabilidad lee `reports/junit-*.xml`.
  - Se añaden `gate:e2e` a `gate:all` y el script `web:dev`.
- **E2E:** contra la API, con base efímera y el simulador. Los datos se preparan con comandos por la API, importando el `design/` del repo con `design.import`, como hacen las pruebas existentes.
- **Calidad visual:**
  - Los tokens y los componentes de §5 del spec, con shadcn/ui reestilizado con esos tokens, nunca con su aspecto por defecto.
  - Densidad, tamaños y marcas como en `docs/ux/canvas/`.
  - Los nombres van antes que los códigos; los códigos, pequeños y en mono.
  - La UI no inventa datos: si el back no da algo, no se muestra.
- **Acciones:** la UI nunca fija a mano qué acciones hay. Salen de `/api/tables` y `/api/commands` (AC-WEB-001-02).
- **Al cerrar cada corte:**
  - capturas de Playwright a 1440 × 900 de cada pantalla del corte en `reports/screens/corte-N/`, para que la persona las revise sin parar la sesión;
  - una nota en el informe con lo hecho.

## 7. Cuándo parar y preguntar

Solo en estos casos:
- `gate:all` no pasa en `v2` antes de empezar;
- hace falta un cambio de back fuera de la sección 4 y la pantalla no tiene sentido sin él;
- un AC contradice a otro o a una regla de `AGENTS.md`.

En cualquier otro caso, se decide con el criterio del spec, se anota en el informe y se sigue.

## 8. Hecho (condición de fin)

- Los cortes 0 a 7 están implementados en `v2-frontend-h1`.
- Cada AC automático de ADR-WEB-001 y FDR-INT-001 tiene al menos una prueba que pasa.
- Los dos documentos llevan `increment: H1`, y `pnpm gate:all` pasa en verde, con `gate:e2e` y la trazabilidad.
- Existe `docs/informe-autonomo-v2-frontend-h1.md`, en español, con:
  - lo que hay en cada corte y el estado de cada AC;
  - los cambios en el back;
  - las desviaciones del spec y las decisiones tomadas en nombre de la persona;
  - lo que queda pendiente;
  - cómo arrancarlo (`pnpm web:dev` y la API);
  - dónde están las capturas;
  - cómo ratificar H1 desde la UI. Hay que reimportar `design/` en la instancia, porque el lote pendiente es anterior a ADR-WEB-001 y FDR-INT-001.
- No se ha hecho push ni se ha tocado `main`.
