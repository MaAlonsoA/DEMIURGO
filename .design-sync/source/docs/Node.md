---
category: Cards
---

The small size of the card template: one 44px row for trees, lists and the small things on the map.

On the map, features are cards and what defines them (questions, checks, rules) are nodes. Pass the type, the certainty (or `parked`), the title and anything that belongs at the end of the row: StageBars for a feature, NeedsYou, a Signal. `selected` draws the blue outline.

```jsx
<Node type="question" state="open" title="Who can sign up?" trailing={<NeedsYou count={1} />} />
```
