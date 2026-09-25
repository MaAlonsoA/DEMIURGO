---
category: Marks
---

How far a feature is: a three-bar track, ready · built · verified, with no text on the card.

Only features carry it, right after their certainty dot. The dots say how sure; the bars say how far.

| stage | Track |
|---|---|
| `not-ready` | three empty bars |
| `ready` | first bar in ink: Ready to build |
| `building` | second bar in amber |
| `verified` | three bars in ink |
| `in-doubt` | first bar in rust: it was ready and something holds it back |
| `first-only` | ready, with built and verified shown dashed (not active yet) |

- On cards leave `label` off: the word shows on hover. Never put a "Ready to build" pill on a card.

```jsx
<StageBars stage="ready" />
```
