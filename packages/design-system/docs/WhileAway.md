---
category: Patterns
---

What happened since the last visit, one line per thing, with who did it.

Shown on the overview when the person comes back, with the "what changed" lens on. End by saying what did not happen when that matters. Use `who: 'waited'` for time that passed with nothing done.

In an app: `title` replaces the heading (e.g. with "since Thursday"), `onShowAll` makes Show everything a button, `note` closes the list ("Nothing you confirmed was changed."), and each item takes a `trailing` mark, the app's `whoMark` and an `id` (as `data-id`). `width` takes any CSS width.

```jsx
<WhileAway items={[{ time: 'Thu 18:52', who: 'demiurgo', text: 'Drafted Sign up for an activity.' }]} />
```
