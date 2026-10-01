---
name: writing-acs
description: How to write acceptance criteria that can be verified.
---
Each acceptance criterion is an observable statement: Given…, when…, then….

- It describes behavior the person can see, not implementation.
- `verification` is `automatic` when a test in CI can check it, `manual` when a person has to judge it, and `release` when it can only be decided against the deployed release candidate (real hosting, network, provider behaviour, cold starts, capacity): an automated check runs there, not in CI (Jez Humble and David Farley, "Continuous Delivery", deployment pipeline: later stages such as capacity and acceptance testing run against a deployed environment).
- `check` says how it is checked, in product terms, concretely enough that two people would check the same thing.
- Avoid vague words (fast, easy, friendly, robust) unless the criterion says how they are measured.
- Criteria don't overlap: each one covers a distinct behavior.
- In a feature (FDR), Behavior is the main flow as 3 to 9 numbered steps (Alistair Cockburn, Writing Effective Use Cases), one short line each, with no rules or edge cases. Each criterion covers one rule or edge case (never a copy of a step) and sets `step` to the 1-based number of the Behavior step it checks; every step has at least one criterion (our convention). `step` is null only in records without Behavior (epics; a task has no criteria: it covers those of its feature).
- A feature must be Small and Testable (INVEST, Bill Wake); there is no cap on criteria. Estimate its T-shirt size (XS to XL); if it is XL (too large to fit easily in one iteration, Mike Cohn; "XL means split" is our convention), split it with story-splitting patterns (SPIDR, Mike Cohn; Richard Lawrence's patterns).
- Prefixing an automatic criterion's test title with its code is our convention, not a standard.
- Each automatic criterion's `check` names the lowest level that can check it: unit or integration test for rules, calculations, validation and data; end-to-end only for screen behaviour and user journeys; `manual` or `release` otherwise (Ham Vocke, "The Practical Test Pyramid": push tests down to the lowest level that can check the behaviour, and have fewer high-level tests). A criterion is checked at one level, not at several.
- A cross-cutting criterion (access control, accessibility, a performance budget that applies to many screens or routes) is written once, for the product or for the feature that first needs it, and states that it applies to every route or screen; it is checked by one parameterized test over the list of routes or screens (Gerard Meszaros, "xUnit Test Patterns", Parameterized Test). Do not restate it in each feature that adds a screen (not repeating it is our convention, based on DRY, Hunt and Thomas, "The Pragmatic Programmer").
