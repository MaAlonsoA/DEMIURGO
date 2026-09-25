---
category: Signals
---

A card signal: a small icon and a number. Show only what is not zero, at most four per card.

Kinds: `checks` (n/m passed), `depends-on` (n), `assumptions` (rests on n assumed answers), `conflict` (n), `needs-review`, `blocked`, `changed` (vN). Conflict, needs review and blocked read in rust. Pointing at a signal explains it.

```jsx
<Signal kind="checks" value="2/3" />
```
