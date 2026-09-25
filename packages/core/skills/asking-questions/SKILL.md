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
