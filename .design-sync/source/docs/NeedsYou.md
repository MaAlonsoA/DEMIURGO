---
category: Signals
---

The one way DEMIURGO asks for attention: a blue counter, with the words Needs you in the header.

One symbol and one phrase in the whole app. In the header it reads "Needs you" with the count; on a card it sits on the top-right corner. It renders nothing when the count is zero.

- Never use "Waiting for you", "Action required" or another color for the same meaning.

```jsx
<NeedsYou count={3} label />
```
