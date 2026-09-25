---
category: Patterns
---

One proposal at a time, from DEMIURGO or an agent: what it changes, why in the author's own words, and Accept, Change or Reject.

- The author shows with its WhoMark and name; an agent's sources are marked unverified.
- DEMIURGO adds a `note` when a proposal grows the feature beyond the idea.
- Reject asks why, and the author sees it; "Not now" keeps it as an idea (Parked).
- When another accepted proposal changes the same thing, pass `outOfDate` with the reason: it shows the grey clock and offers no Accept.
- An agent's batch is resolved one proposal at a time, never all at once.

```jsx
<Proposal author="agent" authorName="Claude Code" position="1 of 4" type="check" kindLabel="New check"
  title='Full activities say "Full"' why="Members kept tapping full activities." source="clubactivities.org/agenda" />
```
