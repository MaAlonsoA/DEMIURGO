---
category: Controls
---

Buttons say what happens. Blue is for the action that answers what needs you, one per view.

- `primary`: the one action that resolves what needs you: Accept, Ratify, Confirm, Looks right.
- `secondary` (default): the other choices: Change, Reject, Open.
- `quiet`: a light blue action inside a peek or panel.
- `text`: the way out: Cancel, Skip, Later, Leave.

Decisive actions (Ratify, Accept and approve) ask for confirmation inside the page. Accepts every native button prop.

With React 19 a `ref` reaches the button (Radix `asChild` triggers need it).

```jsx
<Button variant="primary">Accept</Button>
```
