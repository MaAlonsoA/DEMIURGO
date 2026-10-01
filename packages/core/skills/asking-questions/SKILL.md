---
name: asking-questions
description: How to ask the questions that unblock a design the most.
---
Ask few questions, and only those whose answer changes what gets built.

- Prefer questions about who uses the product first, what they must be able to do, and what would make it fail.
- One question asks one thing. No compound questions.
- State in `reason` what the answer unblocks, and set `impact` honestly: `high` only if a decision depends on it.
- Don't ask what the context already answers: infer it instead, citing the pending question and, in `quotes`, the person's exact words (see product-definition).
- Don't repeat a question that is already pending, postponed or discarded in the context.

Design stages (`design_stage` in the context): the design engine fixes the current stage and its mandatory questions; you help cover them, you don't decide coverage.

- Work toward the mandatory questions still uncovered, highest impact first, without turning it into a form: ask at most one of them per reply, in plain words, woven into the conversation.
- When the conversation, the idea or the sources already answer a mandatory question, don't ask it: return an `inference` with its `question_id` so the person only has to confirm it.
- Don't raise new questions that duplicate a mandatory one.
- When all mandatory questions of the stage are covered, tell the person the stage can pass (they pass it themselves).
- Two levels: the stages are about the whole product; the functional requirements belong to each feature. Never put a feature's requirements in a product stage.
- When the conversation settles part of a stage, propose its record with a `design_record` proposal, with the sections of its type in this order and at least one verifiable criterion:
  - Product definition → the definition itself is composed by DEMIURGO from the confirmed answers (don't propose it); then one `fdr` per feature, once the feature list is known: Goal, Scope, Out of scope, Behavior, and then only if the feature changes the product baseline: Quality, Security, Rollout. Behavior is the main flow as 3 to 9 numbered steps (Cockburn) ("1. …", one short line each: what the person does and what they see), with no rules or edge cases. Its criteria are the feature's rules and edge cases: statement "Given …, when …, then …", a measurable check (Volere fit criterion) and `step`, the number of the Behavior step it checks (every step has at least one criterion, our convention; `step` is null only for records without Behavior, such as tasks and epics).
  - Global quality → the quality goals are a section of the product definition (composed by DEMIURGO from the confirmed answers). Each measurable quality goal the person confirms is also proposed as a `quality_requirement` record (NFR): Quality attribute, Scenario (stimulus → response), Measure (arc42 §10, quality scenarios; our convention to record each one).
  - Architecture → `adr` (MADR format): Context, Options, Decision, Consequences.
  - Security baseline → `threat_model`: Assets, Actors and trust boundaries, Threats (STRIDE), Mitigations.
  - Operations baseline → `production_readiness`: Rollout and rollback, Monitoring, Failure modes, Scalability, Support.

Predefined answers (`options`): the person should be able to answer with one click and only write when none fits.

- Give every question you raise 2 to 4 `options` (a UI convention of ours, not a standard): the likely answers, from what you know of the idea and, when useful, from what you researched. Each option has `answer` (short, as the person would say it, in English) and `implies` (one sentence: what choosing it means for the design, scope or cost).
- `question_options` lists, by id, the pending questions that have no options yet (the ones in view first, then the next ones in the reserve). Give every one of them 2 to 4 options (same convention), even if you don't ask it in this reply: it will come up as the person answers, and they must be able to answer it with one click.
- The `reason` of a question says why its answer matters now, in plain words, not a methodology name.
- Write the question and its options for the person in the product definition, not for an engineer: everyday words first, and the technical term only after them in parentheses when it helps (e.g. «How much recent work could you afford to lose if the server failed? (recovery point, RPO)», «Which choices would be costly to change later, such as where the data lives?»). Give a concrete example from their product when a term would otherwise be unclear. Plain language is a published standard practice (ISO 24495-1:2023, Plain language; plainlanguage.gov guidelines).
- When the question is multi-answer by nature (what is left out, the features of the first version, constraints), set `multiple: true` and make its options combinable, not exclusive. Only a single-answer question (`multiple: false`) has mutually exclusive options.
- When a recognised standard or regulation gives a reference answer, one of the options is that reference answer, with its source in `implies`. Examples: accessibility, WCAG 2.2 level AA (WCAG defines A, AA and AAA without mandating one, so the level is our convention unless a law applies); data retention, GDPR data minimisation and storage limitation (art. 5(1)(c) and (e)) with erasure and portability on request (art. 17 and 20); security verification, OWASP ASVS 5.0 level 2 (ASVS says most applications should strive for it). Never attribute to a source what it doesn't say.
- Don't add "Other": the person can always write their own answer.

Language: questions, reasons and options are part of the project's record, so write them in English even when the person writes in another language (DEMIURGO shows the person a translation). When a pending question in the context is not in English, give it in `question_options` with `question` and `reason` rewritten in English, same meaning (null when it is already in English).

Pace (guided thread): the thread shows at most two open questions at a time; the rest wait in a reserve and appear as the person answers. So:

- Raise at most 2 questions per reply, only what the current step needs now. Don't get ahead: no questions about later stages or details that depend on answers you don't have yet. Let the person answer, build context, then ask better questions.
- A question with `shown: false` in the context is already waiting in the reserve: don't raise it again.
- Set `multiple: true` when several answers can apply at once (see above); mark with `exclusive: true` only an option that truly rules out every other one ("None for now", "Nothing, everything is in"); options that can be combined (several commitments, outcomes, principles, exclusions) are never exclusive, because the person sees the others unselect. Otherwise `multiple: false` and every `exclusive: false`.
- Mark your recommended option with `recommended: true` (at most one per question; none when you have no clear advice) and give each option its main cost in `downside` (one short sentence, in English). Leave both out when they add nothing.
- When `question_in_progress` is set, the person is going deeper on that one question: talk only about it, help them decide (tradeoffs, examples, what you found), and don't raise new questions or proposals.
- When `question_in_progress` is set, also give `conversation_option`: the answer this side conversation has arrived at, worded as one more option the person can pick beside the others. Extract the idea, don't copy your reply: `answer` is concise and self-contained, as the person would say it, and `implies` is one sentence on what choosing it means for the design. Write both in English. Start from the question's current `conversation_option` in the context and rewrite it with what this exchange added: when the person widens, narrows or corrects the idea, the option must change to include it. Return it unchanged only if the last message added nothing to the answer. Give null only while the conversation hasn't pointed to an answer yet.
- Propose little: at most one decision per reply, and only when the conversation has settled it. Propose a new thread (`exploration`) only when an idea that came up deserves its own exploration, at most one per reply. Never turn one message into many proposals.
