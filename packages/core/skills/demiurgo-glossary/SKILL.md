---
name: demiurgo-glossary
description: DEMIURGO's vocabulary, so every agent uses the words the same way.
---
- **Exploration** (thread): a conversation with a purpose; it raises questions and ends in decisions or new explorations.
- **Question**: something that must be known to decide. Pending, inferred (DEMIURGO concluded it), confirmed (the person did), postponed or discarded.
- **Decision**: a choice with its context, the decision itself and its consequences. Only the person approves it.
- **Epic** (EPC): a capability of the first version too big for one feature. It has a goal, its features in order (the smallest end-to-end walk first) and what "done" means for the whole walk. The person approves it. Its features are the list it keeps (each with a name, one sentence and its reserved FDR code): the list changes on its own (add, drop, move), never as text in a section of the epic.
- **Planned feature**: a feature its epic lists that is not designed yet. Designing it makes its FDR with that same code; only a planned one can be dropped, and a code is never reused.
- **FDR**: a feature design (goal, scope, out of scope, behavior) with acceptance criteria.
- **Task** (TSK): a piece of the construction of a feature, small enough to build and check on its own. It rests on its approved feature and has its own acceptance criteria, finer than the feature's. It comes from the feature's thread or is written by hand; the person approves it.
- **AC** (acceptance criterion): an observable statement, "Given …, when …, then …", that says when the feature is done. In a feature it checks one Behavior step (`step`, 1-based); the Behavior is the main flow in 4 to 7 numbered steps.
- **Proposal**: anything an agent suggests. It has no effect until the person accepts it.
- **Authority**: what the person approved. Agents never create authority; they only propose.

How the design is layered, each level resting on the one above:

1. **Product definition** (DEF): what the product is for and for whom, its principles, constraints, quality goals and the features of the first version.
2. **Epic** (EPC), only when a capability of the first version is too big for one feature: its goal and its features in order. It rests on the definition.
3. **Feature** (FDR): what one capability does, with its requirements and how each is checked. It rests on its epic, or on the definition when it is not part of one.
4. **Decision** (ADR, a threat and its mitigation): how something a feature forces is solved, when there are at least two real options. It rests on a feature, or on a constraint or quality goal of the definition.
5. **Build and evidence**: the code and the executed checks that show the feature does what was agreed.

Feature or epic, the same test for any product: a feature is one person with one goal that can be checked end to end on its own, in a handful of acceptance criteria (at most 12). When a capability holds several goals that could each be ready on their own, or would need more, it is an epic: split it into features. A restaurant booking app's "Bookings" is an epic (book a table, cancel, waiting list); its "SMS reminder" is a feature; a studio's "Landing page" is a feature.

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
| épica, funcionalidad | epic, feature |
| requisito, requisito de calidad, modelo de amenazas | requirement, quality requirement, threat model |
| listo para construir | ready to build |

The project's own glossary, when the context carries one (`glossary`), takes precedence over this table.
