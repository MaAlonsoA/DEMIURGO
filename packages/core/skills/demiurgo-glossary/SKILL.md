---
name: demiurgo-glossary
description: DEMIURGO's vocabulary, so every agent uses the words the same way.
---
- **Exploration** (thread): a conversation with a purpose; it raises questions and ends in decisions or new explorations.
- **Question**: something that must be known to decide. Pending, inferred (DEMIURGO concluded it), confirmed (the person did), postponed or discarded.
- **Decision**: a choice with its context, the decision itself and its consequences. Only the person approves it.
- **FDR**: a feature design (goal, scope, out of scope, behavior) with acceptance criteria.
- **AC** (acceptance criterion): an observable statement that says when the feature is done.
- **Proposal**: anything an agent suggests. It has no effect until the person accepts it.
- **Authority**: what the person approved. Agents never create authority; they only propose.

How the design is layered, each level resting on the one above:

1. **Product definition** (DEF): what the product is for and for whom, its principles, constraints, quality goals and the features of the first version.
2. **Feature** (FDR): what one capability does, with its requirements and how each is checked. It rests on the definition.
3. **Decision** (ADR, a threat and its mitigation): how something a feature forces is solved, when there are at least two real options. It rests on a feature, or on a constraint or quality goal of the definition.
4. **Build and evidence**: the code and the executed checks that show the feature does what was agreed.

A proposal is not a level: it is how anything at any level arrives (proposed by an agent, accepted and then approved by the person). Features come before decisions: a decision without a feature, constraint or quality goal to rest on is a guess, so it stays a principle or an open question. Decisions forced by a constraint live in the definition's principles; decisions that span features (the system's structure, its stack) are taken in the architecture stage, which opens once a feature is approved.

When the person writes in Spanish, record these words with their fixed English term:

| Spanish | English |
|---|---|
| hilo, exploración | thread, exploration |
| pregunta, pendiente, inferida, confirmada, aplazada, descartada | question, pending, inferred, confirmed, postponed, discarded |
| decisión, contexto, consecuencias | decision, context, consequences |
| criterio de aceptación | acceptance criterion |
| alcance, fuera de alcance, comportamiento, objetivo | scope, out of scope, behavior, goal |
| propuesta, lote, paquete | proposal, batch, package |
| autoridad, aceptar, rechazar | authority, accept, reject |
| conocimiento, fuente | knowledge, source |
| requisito, requisito de calidad, modelo de amenazas | requirement, quality requirement, threat model |
| listo para construir | ready to build |

The project's own glossary, when the context carries one (`glossary`), takes precedence over this table.
