# Words and states

The interface puts the back end's states into its own words. What an element can do still comes from the back end's tables; this is only how it reads.

## States

| Back end | Word | Mark |
|---|---|---|
| Version · draft | Draft | Proposed |
| Version · approved (current) | Approved | Confirmed |
| Version · superseded | Replaced | Replaced |
| Version · discarded | Discarded | Dropped |
| Question · pending | Open | Open |
| Question · inferred | Assumed | Assumed |
| Question · confirmed | Confirmed | Confirmed |
| Question · postponed | Parked | Parked |
| Question · discarded | Dropped | Dropped |
| Proposal · pending | Proposed | Proposed |
| Proposal · accepted, accepted with edits | Accepted | Confirmed |
| Proposal · rejected | Rejected | Dropped |
| Proposal or batch · obsolete | Out of date | Out of date |
| Link · pending review | Needs review | Problem |
| Link · obsolete | Out of date | Out of date |
| Run · queued, running | Queued, Working | Working |
| Run · failed, interrupted | Failed, Interrupted | Problem |
| Run · cancelled | Cancelled | Inactive |
| Knowledge update · queued, classifying, verifying | Updating | Working |
| Knowledge update · rejected | Failed | Problem |
| Classification · pending review | Needs review | Needs you |
| Thread · set aside | Set aside | Parked |
| Observation · claim, hypothesis | Claim, Hypothesis | Proposed |
| Observation · unknown | Unknown | Unknown |

## Who

| Actor | Mark |
|---|---|
| `human:<person>` | You |
| `agent:run:<id>` | DEMIURGO, with the model |
| `agent:<name>:<token>` | Agent, with its name |
| `system:<component>` | Automatic |

## Names

| Interface | Back end |
|---|---|
| Feature | FDR |
| Tech decision | ADR |
| Decision | Decision (DEC) |
| Check | Acceptance criterion (AC); Automatic = automatic, You = manual |
| Thread | Exploration |
| Package | A batch from DEMIURGO or the system: accepted whole |
| Batch | A batch from an agent: one proposal at a time |
| Needs you | The inbox |
