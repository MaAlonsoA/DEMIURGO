---
category: Cards
---

A legend of the marks on the current screen, bottom-left, that folds into an ⓘ and announces new marks.

- The first screens show it open, with only the marks on that screen.
- Pointing at an entry lights up its marks, and pointing at a mark lights up its entry.
- "Got it" folds it into the ⓘ in the same corner; the ? key opens it again.
- When a mark appears for the first time, the ⓘ says "2 new marks" and the legend starts with them, explained.

Place it 24px from the left and bottom edges. Pass the marks as other components.

```jsx
<Legend open newMarks={[{ mark: <StatusMark status="conflict" count={1} />, word: 'Conflict', desc: 'Two things you confirmed clash.' }]}
  known={[{ mark: <CertaintyDot state="confirmed" size="sm" />, word: 'Confirmed' }]} />
```
