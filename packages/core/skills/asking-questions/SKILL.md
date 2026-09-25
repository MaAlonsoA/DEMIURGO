---
name: asking-questions
description: How to ask the questions that unblock a design the most.
---
Ask few questions, and only those whose answer changes what gets built.

- Prefer questions about who uses the product first, what they must be able to do, and what would make it fail.
- One question asks one thing. No compound questions.
- State in `reason` what the answer unblocks, and set `impact` honestly: `high` only if a decision depends on it.
- Don't ask what the context already answers: infer it instead, citing the pending question.
- Don't repeat a question that is already pending, postponed or discarded in the context.

Design stages (`design_stage` in the context): the design engine fixes the current stage and its mandatory questions; you help cover them, you don't decide coverage.

- Work toward the mandatory questions still uncovered, highest impact first, without turning it into a form: ask at most one of them per reply, in plain words, woven into the conversation.
- When the conversation, the idea or the sources already answer a mandatory question, don't ask it: return an `inference` with its `question_id` so the person only has to confirm it.
- Don't raise new questions that duplicate a mandatory one.
- When all mandatory questions of the stage are covered, tell the person the stage can pass (they pass it themselves).
- Two levels: the stages are about the whole product; the functional requirements belong to each feature. Never put a feature's requirements in a product stage.
- When the conversation settles part of a stage, propose its record with a `design_record` proposal, with the sections of its type in this order and at least one verifiable criterion:
  - Product definition → one `fdr` per feature, once the feature list is known: Goal, Scope, Out of scope, Behavior, and then only if the feature changes the product baseline: Quality, Security, Rollout. Its criteria are the feature's requirements: statement in EARS ("When <trigger>, the system shall <response>") and a measurable check (Volere fit criterion).
  - Global quality → `quality_requirement`: Quality attribute, Scenario (stimulus → response), Measure.
  - Architecture → `adr`: Context, Options, Decision, Consequences.
  - Security baseline → `threat_model`: Assets, Actors and trust boundaries, Threats (STRIDE), Mitigations.
  - Operations baseline → `production_readiness`: Rollout and rollback, Monitoring, Failure modes, Scalability, Support.

Predefined answers (`options`): the person should be able to answer with one click and only write when none fits.

- Give every question you raise 2 to 4 `options`: the likely, mutually exclusive answers, from what you know of the idea and, when useful, from what you researched. Each option has `answer` (short, in the person's words) and `implies` (one sentence: what choosing it means for the design, scope or cost).
- Also give `question_options` for the pending questions in the context that have no options yet, especially the stage's mandatory ones, with their `question_id`.
- The `reason` of a question says why its answer matters now, in plain words, not a methodology name.
- Don't add "Other": the person can always write their own answer.

Language: write every question, reason and option in the language the person writes in. The design engine's mandatory questions come in English: when a pending question in the context is in another language than the person's, give it in `question_options` with `question` and `reason` rewritten in the person's language, same meaning (null when it is already in their language).
