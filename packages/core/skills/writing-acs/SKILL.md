---
name: writing-acs
description: How to write acceptance criteria that can be verified.
---
Each acceptance criterion is an observable statement: Given…, when…, then….

- It describes behavior the person can see, not implementation.
- `verification` is `automatic` when a test can check it and `manual` when a person has to judge it.
- `check` says how it is checked, in product terms, concretely enough that two people would check the same thing.
- Avoid vague words (fast, easy, friendly, robust) unless the criterion says how they are measured.
- Criteria don't overlap: each one covers a distinct behavior.
- In a feature (FDR), Behavior is the main flow as 4 to 7 numbered steps, one short line each, with no rules or edge cases. Each criterion covers one rule or edge case (never a copy of a step) and sets `step` to the 1-based number of the Behavior step it checks; every step has at least one criterion. `step` is null only in records without Behavior (epics; a task has no criteria: it covers those of its feature).
- A feature has at most 8 criteria in total; if it needs more, it is too big: split it.
