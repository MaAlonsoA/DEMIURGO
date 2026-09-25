---
category: Cards
---

A feature on the map or the overview: the six-zone card template.

Zones: what it is (icon and type), how sure and how far (dot, word and stage bars), Needs you (the counter on the corner), title and one line in plain words, who and when, and signals (at most four, only what is not zero). 146px tall.

The border follows the dot: solid when confirmed or proposed, dashed when open; `selected` draws a 2px blue border with a ring. Pointing at a card shows its detail floating beside it (Panel with `floating`); a click pins it.

Every type uses the same template: pass `type` for anything that is not a feature, and leave `stage` out (only features have bars). In an app, `mark`, `bars` and `whoMark` take the app's own marks for zone 2 and the footer (with their tooltips), and `width` takes any CSS width. The title keeps one line and the line two.

```jsx
<FeatureCard state="proposed" stage="not-ready" needs={1} title="Sign up for an activity"
  line="A member takes a place in one step." who="demiurgo" when="18:52"
  signals={<Signal kind="assumptions" value={1} />} />
```
