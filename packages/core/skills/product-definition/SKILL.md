---
name: product-definition
description: How to write the answers of the product definition stage, and how to work within the approved definition.
---
The product definition says what the product is, what it builds first and how. DEMIURGO composes it,
without AI, from the answers the person confirmed in the product definition stage: each section is one
answer. So an answer you infer is, once the person confirms it, a sentence of the definition. Write it
as one.

How each answer is written (in English, short, only what the person said or clearly implied):

- Purpose: the job the product does, for whom and in which situation. "When <situation>, <who> wants to
  <job>, so that <result>." One or two sentences, no marketing. A restatement of the idea ("The product
  helps me keep track of X") is not a purpose: when the idea doesn't say the job and for whom, ask.
- Outcomes: the things someone could observe when it works ("Organizers know who is coming the
  day before a trip"): what changes for someone, not what the product can do. A capability ("Customers
  can book online") goes in First version, never here. Infer outcomes only from what the person said
  success, or the change they want, looks like. No invented numbers: a number only when the person gave it.
- Principles: two to four rules that settle a choice between two reasonable options, each as
  "<this> over <that>" or a short imperative, with its reason when the person gave one.
- Users: who uses it, the first one first, and what each needs to do.
- Problem: what goes wrong today without the product, in the person's terms.
- First version: the capabilities it must have, one per line. Each becomes a feature to design, or an
  epic split into features when it is too big for one (see demiurgo-glossary). The
  capabilities the idea names are its first version, even when it names only one.
- Out of scope: what the first version leaves out, one per line.
- Constraints: what is fixed (platform, budget, deadlines, regulations, existing systems).
- Quality goals (Global quality stage): each line carries a measurable target, as a verifiable criterion
  does ("recover in under 15 minutes; lose at most the last minute of saved work"). An answer without a
  number or observable threshold ("always available", "fast", "long interruptions are acceptable") is
  not inferred and not accepted: leave the question open and ask for the number, with a concrete option
  to pick. Never invent the number.

Each fact goes in one section: what is left out goes in Out of scope and not again in Constraints; a
capability goes in First version and not again in Outcomes.

Evidence: an inference rests on the person's exact words. In `quotes`, copy one to three short
fragments from the person's own messages, verbatim and in their language, that support the conclusion.
Never paraphrase in `quotes`, never quote your replies, the sources or the context. DEMIURGO checks every
quote against what the person wrote: an inference without a quote it can find is dropped and the
question is asked instead. So when the idea doesn't say it, don't infer it. And an inference is a
sentence the definition could keep as it is: when you would still have to ask what it means, don't
infer it, leave the question open.

Working within the definition (`product_definition` in the context, when there is one): it is the
approved definition of the product, the latest version the person approved.

- Keep every answer, question and proposal within it. Check what you propose against its principles, its
  out of scope and its constraints.
- When what the person asks contradicts it, say so in `reply`, naming the section, and ask whether the
  definition should change. Don't quietly follow the contradiction and don't quietly refuse it.
- When the person decides here something that changes a section (a constraint they lift, a user they
  add, a capability they leave out), propose a `definition_change`: the section, its whole text as it
  should read after the change (in English, written as above), the reason, and `quotes` with the
  person's exact words in this thread that state the decision. Only what the person decided, never
  your own idea of what the definition should say; at most one per section in a turn: every change to the same section goes together in one `definition_change` with the whole new text of the section (two for the same section would compete, and only the last is kept). DEMIURGO drops a change
  whose quotes it can't find in what the person wrote here. Nothing changes until the person accepts
  it.
