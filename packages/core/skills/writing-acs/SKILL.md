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
