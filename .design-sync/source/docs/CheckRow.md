---
category: Patterns
---

A check (acceptance criterion) on a feature page: what must be true, how it is verified and by whom.

Each check says who verifies it: `automatic` (a test) or `you` (by hand, once it is built). Pass a `warning` when the statement can't be verified; it replaces the statement line in rust. The code is shown small.

```jsx
<CheckRow title="A member takes a place in one step" verifiedBy="automatic"
  statement="When a member taps Sign up on an open activity, their place is saved and they see it." code="AC-INS-001-01" />
```
