---
category: Marks
---

How sure DEMIURGO is about something: one dot and one word, on every element of every type.

Put it before the title zone of every card, node and detail. The dot says how sure; the word, when shown, sits to its right.

| state | Word | Means |
|---|---|---|
| `confirmed` | Confirmed | A person said yes: approved version, confirmed question, accepted proposal. |
| `assumed` | Assumed | DEMIURGO concluded it on its own; waiting for the person to confirm. |
| `proposed` | Proposed | Proposed and waiting for a person: a draft, a pending proposal, what an agent claims. |
| `open` | Open | Asked, not answered yet. |
| `unknown` | Unknown | Not asked yet. |

- Confirmed and Assumed have no color of their own. Only Proposed is blue, because it waits for the person.
- Never show something an agent proposed with the Confirmed dot.
- Use `size="sm"` inside cards and nodes.

```jsx
<CertaintyDot state="proposed" size="sm" label />
```
