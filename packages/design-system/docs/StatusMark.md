---
category: Marks
---

Grey marks for things that are no longer active, and the rust Conflict mark.

Use them in place of the certainty dot when something stops being active, and Conflict as a signal.

- `parked`: a postponed question, a thread set aside, an idea kept for later.
- `dropped`: a discarded version or question, a rejected proposal. Always show its reason nearby.
- `replaced`: a superseded version; a newer one was approved.
- `out-of-date`: a proposal, package or link whose basis changed. It offers no Accept.
- `conflict` (with `count`): two confirmed things clash. DEMIURGO recommends but never picks.

```jsx
<StatusMark status="out-of-date" label />
<StatusMark status="conflict" count={1} />
```
