# Contenido canónico en inglés: plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usa superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para ejecutar este plan tarea a tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que todo lo que DEMIURGO guarda como registro (decisiones, FDR, criterios, preguntas, observaciones, nodos de conocimiento y la exportación a `design/`) esté siempre en inglés, mientras la persona conversa en su idioma y la interfaz se muestra en el suyo (primero, español).

**Arquitectura:** tres capas con idioma propio.

| Capa | Idioma | Hoy |
|---|---|---|
| Registros y autoridad | Inglés, fijo | El de la persona (`designer`: «Write in the language of the decision») |
| Conversación (`reply`, `question_options`) | El de la persona | Ya es así (`explorer`, `onboarding`, `asking-questions`) |
| Interfaz | Configurable por persona (en, es) | Solo inglés; sin i18n (`packages/web/src/words.ts` es un diccionario parcial) |

La persona siempre acepta el texto inglés. Para leerlo en su idioma tiene una **traducción de lectura**, cacheada y marcada como «traducción, no autoridad», que nunca entra en el diario ni en el conocimiento.

**Por qué:** un solo idioma en los registros hace homogéneo lo que ven el clasificador, la búsqueda de candidatos y Jev (orientado al inglés, [models](https://docs.typesafe.ai/models.md)), y permite compartir los artefactos.

**Stack:** el actual. Sin dependencias nuevas salvo `@typesafe-ai/sdk` en la fase 4, condicionada.

## Decisiones que tiene que tomar la persona antes de empezar

1. **¿Cuenta el repo?** Hoy `CLAUDE.md` y `AGENTS.md` dicen que la prosa de `design/` va en español. Si `design/` es la exportación canónica de un proyecto de DEMIURGO, tendría que pasar al inglés. La documentación de `docs/` puede seguir en español. Recomendación: `design/` en inglés y `docs/` en español.
2. **¿Qué es «registro»?** Recomendación: todo lo que puede llegar a ser autoridad o alimenta el conocimiento, que son decisiones, FDR, criterios, preguntas (`question`, `reason`), observaciones, conclusiones y `purpose` del hilo. Solo `reply` y la versión mostrada de las preguntas (`question_options`) van en el idioma de la persona.
3. **Motor de la traducción de lectura.** Recomendación: un agente `translator` en el grupo rápido, con Qwen local asignado por defecto. Coste cero, y los datos no salen de casa.
4. **Datos existentes en español.** Recomendación: migrarlos por propuestas (fase 6). La alternativa es convivir con registros en dos idiomas, lo que degrada el clasificador.

## Restricciones globales

- La aceptación es solo humana: ninguna traducción crea ni cambia autoridad por detrás. Pasar un registro al inglés es una **versión nueva propuesta** que la persona acepta.
- Contenido de versiones y criterios inmutable: la traducción de lectura vive en su propia tabla, append-only, fuera de `events`.
- Antes de una migración, un cambio en `design/data/` o `pnpm gen`: `pnpm snap save antes-<fase>`. Las migraciones se añaden siempre nuevas.
- Ninguna llamada real a Claude, Codex ni TypeSafe salvo que la persona lo pida. Las pruebas usan el simulado y fixtures.
- Código en inglés; documentación y commits en español.

## Fase 1: idioma canónico en los agentes

Sin esquema ni migraciones; solo prompts, skills y comprobación.

- [ ] **1.1 Regla de idioma en la skill `structured-output`** (`packages/core/skills/structured-output/SKILL.md`). Sustituye «Texts meant for the person go in their language» por dos reglas:
  - los campos de registro, en inglés aunque la conversación sea en otro idioma;
  - `reply` y `question_options`, en el idioma de la persona.
- [ ] **1.2 Agentes.**
  - `designer`: «Write in English, whatever the language of the decision or the conversation».
  - `explorer` y `onboarding`: `purpose`, observaciones, decisiones, preguntas y conclusiones en inglés, y `reply` en el idioma de la persona.
  - `asking-questions`: las preguntas se guardan en inglés; `question_options` las muestra reescritas en el idioma de la persona.
  - `knowledge_classifier` y `knowledge_reviewer`: «It may be written in Spanish or English» pasa a «It is written in English».
- [ ] **1.3 Glosario de términos.** Añade a `demiurgo-glossary` una tabla es → en con los términos del producto (hilo → thread, decisión → decision, criterio → acceptance criterion…), para que el agente traduzca siempre igual.
- [ ] **1.4 Descripciones de los esquemas.** En `packages/domain/src/agents.ts`, un `.describe('English')` en los campos de registro de `explorationChatOutput` y `designProposalOutput`. El JSON Schema que recibe el modelo lo lleva.
- [ ] **1.5 Comprobación de idioma (aviso, no bloqueo).** Una función pura en `packages/domain` (`looksEnglish(text)`) con una heurística de palabras funcionales. El aplicador registra un evento de aviso si un campo de registro no parece inglés. No se rechaza la salida: un falso positivo no debe romper una ejecución.
- [ ] **1.6 Pruebas.**
  - El simulado (`packages/core/src/agents/simulated.ts`) produce registros en inglés con una conversación en español.
  - Una prueba de `looksEnglish` con casos es/en.
  - Un fixture de `design_proposal` con decisión en español y FDR en inglés.
- [ ] **1.7 Prueba real, con permiso.** Un hilo en español con Qwen local asignado a `explorer` y `designer`. Verifica que `reply` sale en español y los registros en inglés.

## Fase 2: traducción de lectura

- [ ] **2.1 Migración nueva `translations`.**
  - Columnas: `id`, `project_id`, `subject` (tipo + id de versión o propuesta), `lang`, `source_hash`, `text` (JSONB con los campos traducidos), `agent_call_id`, `created_at`.
  - Única por (`subject`, `lang`, `source_hash`) y append-only. Si el original cambia, cambia el hash y se traduce de nuevo.
- [ ] **2.2 Agente `translator`** (`packages/core/agents/translator/AGENT.md`, `action: translate`, grupo rápido, `session: none`).
  - Entrada: los campos y el glosario.
  - Salida: los mismos campos traducidos, con el esquema Zod `translateOutput` en `agents.ts`.
  - Instrucción clave: traducir, no mejorar ni resumir.
- [ ] **2.3 Capacidad.**
  - `translation.request` (`human`, `system`; no decisiva) en `design/data/capabilities.yaml`, y `pnpm gen` con instantánea antes.
  - Consulta `query.translation`.
- [ ] **2.4 Servicio** en `packages/core/src/translation/`:
  - busca en caché por hash;
  - si no está, llama al proveedor por `callProvider`, sin crear ejecución y con el mismo rastro que el clasificador en `agent_calls`;
  - guarda el resultado.
  - Sin motor asignado: 409 «Choose a model for translator».
- [ ] **2.5 API.** `GET /api/projects/:projectId/translations?subject=…&lang=es`. Devuelve la caché o la genera en el momento. Mejora posterior: generarla en segundo plano al crear la propuesta.
- [ ] **2.6 Web.**
  - En `screens/batch/ProposalView.tsx`, `screens/record/*` y `screens/thread/*`, un conmutador «Ver en español».
  - La traducción se muestra con una marca nueva en `MARKS` de `words.ts` (`translation`: «Translation for reading. You accept the English text.»).
  - Los botones de aceptar siempre se refieren al original.
  - Actualiza el comentario de cabecera de `words.ts` («Record prose is shown as it was written, never translated»): la prosa se muestra como se escribió, y la traducción es una vista aparte.
- [ ] **2.7 Pruebas.**
  - Caché por hash: el mismo texto no se traduce dos veces.
  - Cambiar el original invalida la traducción.
  - Aceptar desde la vista traducida acepta la versión inglesa.
  - 403 generado para `translation.request` con actor de agente.

## Fase 3: glosario del proyecto

- [ ] **3.1 Migración nueva `glossary_terms`** (`project_id`, `term`, `lang`, `english`, `note`, `created_by`, `created_at`), append-only; vale la última fila por término.
- [ ] **3.2 Contexto.** El constructor del context pack (`packages/core/src/context/build.ts`) añade los términos del proyecto a las acciones que escriben registros y al `translator`.
- [ ] **3.3 Web.** Una pestaña «Glossary» en el proyecto, con la lista y el alta de términos. Tiene capacidad propia `glossary.set` (`human`).
- [ ] **3.4 Pruebas.** El término aparece en el context pack. Una traducción usa el término fijado (fixture del simulado).

## Fase 4: evaluación en inglés y Jev (condicionada)

- [ ] **4.1 Conjunto en inglés.** Crea `evals/classifier/v1-en/` traduciendo `verdicts.jsonl` e `ideas.jsonl` con los mismos `id` y `expected`. **Lo revisa la persona** antes de usarlo: el README de `v1` ya prevé esta ablación.
- [ ] **4.2 CLI.** `evaluate-classifier` acepta el conjunto (`v1` o `v1-en`) como argumento.
- [ ] **4.3 Línea base.** Evalúa Claude (referencia) y Qwen local sobre `v1` y `v1-en`: cuatro resultados en `evals/classifier/results/`. Con Claude solo con permiso; con Qwen no hay cuota.
- [ ] **4.4 Adaptador Jev**, solo cuando haya clave y créditos.
  - `packages/core/src/classifier/jev.ts` con `@typesafe-ai/sdk`, tal como describe su propio comentario.
  - Cada petición deja su fila en `agent_calls` (proveedor `typesafe`, `usage.input_tokens`), para medir el coste real.
  - La clave va en `.env` como `TYPESAFE_API_KEY`, nunca en el repo.
- [ ] **4.5 Evaluación con Jev.** Sobre `v1-en` y `v1`; coste estimado por debajo de 0,01 $.
- [ ] **4.6 Decisión.**
  - Compara la exactitud por clase y la calibración: la curva cobertura–precisión por umbral decide los umbrales de `routeByConfidence`.
  - Si Jev gana, se redacta una ADR sobre enviar contenido del proyecto a TypeSafe (EE. UU., sin retención cero salvo enterprise). Sin ADR aceptada, Jev no se asigna en la instancia real.

## Fase 5: interfaz en varios idiomas

Independiente de las fases 1 a 4; se puede hacer en paralelo.

- [ ] **5.1 Catálogo propio y tipado**, sin librería, siguiendo la idea de `words.ts`.
  - `packages/web/src/i18n/en.ts` es el catálogo fuente, con los textos de producto en inglés como hoy, y `es.ts` es `Record<keyof typeof en, string>`: si falta una clave, falla la compilación.
  - `useWords()` devuelve el catálogo del idioma activo.
  - Los plurales y variables van con funciones en el propio catálogo.
- [ ] **5.2 Preferencia de idioma** de la persona: columna nueva `locale` en la tabla de personas (migración nueva), expuesta en `/api/session` y cambiable desde el menú de la persona. Por defecto, el del navegador si es `es` y si no `en`.
- [ ] **5.3 Extracción.** Pasa los textos de las pantallas (`packages/web/src/screens/**`, `shell/`, `components/`) al catálogo, una carpeta de pantallas por tarea:
  - primero `batch` y `record`, donde se acepta;
  - después `thread`, `needs-you`, `models` y el resto.
  - `MARKS` y el resto de `words.ts` se mueven al catálogo.
- [ ] **5.4 Errores de la API.** La web traduce por código (403/409/422 y los códigos de dominio) y usa el mensaje inglés solo como respaldo.
- [ ] **5.5 Vigilancia.** Una prueba unitaria o regla de lint que falla con texto literal en JSX fuera del catálogo, como hace `design-system.test.ts` con colores y tamaños.
- [ ] **5.6 Formato.** Fechas y números con `Intl` y el `locale` activo.

## Fase 6: migración del diseño existente

La última, porque necesita la fase 1 (los agentes ya escriben en inglés) y conviene tener la 2 (la persona revisa con la traducción al lado).

- [ ] **6.1 Instantánea:** `pnpm snap save antes-migracion-ingles`.
- [ ] **6.2 Acción `translate_records`.** Recorre los registros vigentes en español (decisiones, FDR, criterios, preguntas) y crea un **lote de propuestas de versión nueva** en inglés por hilo o por FDR, con el original al lado.
- [ ] **6.3 Aceptación por paquetes.** La persona los acepta con `batch.accept_package`: nada cambia sin ella. Las huellas y versiones cambian como en cualquier versión nueva.
- [ ] **6.4 Conocimiento.** Tras aceptar, «Actualizar conocimiento» reconstruye el grafo con la huella nueva.
- [ ] **6.5 Exportación.** `export-design` genera `design/` en inglés. Si la persona decidió (decisión 1) que el repo pasa al inglés, se actualizan `CLAUDE.md` y `AGENTS.md`.

## Orden, dependencias y esfuerzo

| Fase | Depende de | Esfuerzo | Coste de modelos |
|---|---|---|---|
| 1. Agentes en inglés | — | Pequeño | 0 (Qwen en la prueba real) |
| 2. Traducción de lectura | 1 | Medio | 0 con Qwen local |
| 3. Glosario | 2 | Pequeño | 0 |
| 4. Evaluación y Jev | 1 (idioma decidido) | Pequeño + adaptador | < 0,01 $ con Jev; Claude, con permiso |
| 5. Interfaz i18n | — | Grande (≈130 archivos `.tsx`) | 0 |
| 6. Migración | 1, 2 | Medio + revisión de la persona | 0 con Qwen local |

Orden recomendado: 1 → 2 → 4 → 3 → 6, con la 5 en paralelo cuando haya tiempo.

## Riesgos

- **Matices perdidos al redactar en inglés** desde una conversación en español. Se mitiga con el glosario (1.3 y fase 3) y la traducción de lectura (fase 2).
- **Aceptar sin entender.** La persona siempre ve la traducción al lado, marcada, y acepta el original.
- **Heurística de idioma con falsos positivos** en textos cortos o técnicos: por eso solo avisa (1.5).
- **Qwen como traductor.** Hay que verificar la calidad con unos pocos registros reales antes de la fase 6.
- **Jev y los datos.** Queda fuera de la instancia real hasta la ADR (4.6).

## Estado de la implementación (28-09-2026, rama `v2.2-ingles`)

Decisiones tomadas, con la recomendación del plan salvo la primera, que ya resolvía `AGENTS.md`:

1. El `design/` del repo no se toca: `AGENTS.md` lo declara referencia histórica, que no se exporta encima. La regla de idioma del producto queda en `AGENTS.md`.
2. Es registro todo lo que escribe un agente salvo `reply`: preguntas, razones, opciones, observaciones, inferencias, propuestas y propósito. `question_options.question/reason` sirve ahora para pasar al inglés las preguntas pendientes antiguas, en lugar de reescribirlas al idioma de la persona.
3. El traductor es un agente propio, `translator`, sin grupo, con Qwen local por defecto.
4. Los registros en español se migran por propuestas.

| Fase | Estado | Qué quedó |
|---|---|---|
| 1. Agentes en inglés | Hecha | Reglas en `structured-output`, `asking-questions` y los agentes; tabla es→en en el glosario; campos de registro marcados «In English.» en los esquemas; `detectLanguage`/`looksEnglish`, que solo avisa y elige qué migrar. |
| 2. Traducción de lectura | Hecha | Migración 0014 (`translations`, `humans.locale`); `query.translations` y `person.set_locale`; caché por huella del origen y del glosario; marca «Traducido · Ver el original» en preguntas, observaciones, propuestas, propósito del hilo y versiones. Las acciones siempre actúan sobre el inglés. |
| 3. Glosario | Hecha | Migración 0015; `glossary.set`/`glossary.remove`, decisivos y solo humanos; entra en el context pack de `exploration_chat` y `design_proposal` y en el traductor; pestaña Glossary en Conocimiento. |
| 4. Evaluación y Jev | Parcial | `v1-en` traducido por un agente, **pendiente de revisión de la persona**; `evaluate-classifier … [v1\|v1-en]`. Con Qwen local, en la partición de prueba: veredictos 74,3 % (es) y 80,0 % (en); ideas 81,8 % y 86,4 %. **Pendiente:** 4.4–4.6 (adaptador Jev, evaluación con Jev y ADR), que necesitan clave y créditos de TypeSafe. Tampoco se ha evaluado Claude: gasta cuota. |
| 5. Interfaz i18n | Hecha, con costuras | Idioma de la persona en su sesión; selector en su menú; catálogos tipados `words.i18n.ts` por carpeta; `<html lang>`; fechas con `Intl`; errores de la API con frase de cabecera en español; prueba `i18n-literals.test.ts` que vigila que no quede prosa literal en JSX; e2e `language.spec.ts`. **Costuras:** algunos ayudantes puros probados por su texto inglés exacto siguen en inglés (`batch/model.ts`, `batch/proposal.ts`, `record/logic.ts`, `run/runs.ts`, `run/phases.ts`, `models/engines.ts`, `activity/summary.ts`, `knowledge/graph.ts`, `knowledge/taxonomy.ts`, `overview/lens/lines.ts`, `overview/needs.ts`, `origins/tree.ts`, `onboarding/day.ts`, los formularios de alta y versión nueva, `components/explain.ts`). Sus frases aparecen en inglés dentro de páginas en español: el siguiente paso es darles un parámetro de catálogo, como ya tienen `answers.ts`, `review.ts` o `rail.ts`. |
| 6. Migración | Hecha | Tipo de propuesta `record_translation`, solo del sistema: al aceptarlo crea una versión nueva con la prosa en inglés, criterios arrastrados como modificados y enlaces vigentes. `proposeEnglishVersions` / CLI `translate-records <projectId> [limit]` propone en lotes resueltos propuesta a propuesta, con dependencia en la versión traducida. **Pendiente:** ejecutarlo sobre la instancia real, cuando la rama esté desplegada y con instantánea antes. |

Para aplicarlo en la instancia 8100:

1. `pnpm snap save antes-contenido-en-ingles`.
2. Integrar la rama; el API aplica las migraciones 0014 y 0015 al arrancar y siembra `translator` con Qwen local.
3. Elegir el idioma en el menú de la persona.
4. `docker compose exec api node packages/api/src/cli.ts translate-records <projectId>` para proponer las versiones en inglés.

Desde el Mac mini, el `node` del host no tiene permiso de Red local para llegar al PC de NInfer; dentro de los contenedores sí llega.
