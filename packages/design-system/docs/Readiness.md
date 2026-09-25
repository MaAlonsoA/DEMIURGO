---
category: Patterns
---

Before it can be built: what still stops a feature, in product words, until it reads Ready to build.

Pass the reasons exactly as the back end gives them. `kind: 'warning'` (a check that may be hard to verify) never blocks and reads in rust; `kind: 'assumed'` marks an assumed answer waiting to be confirmed. With no items it shows Ready to build and the first bar filled, plus what comes `next`.

Only warnings still reads Ready to build, with the warnings under it. Each line carries `data-kind` (`reason`, `warning` or `assumed`), and an item's `mark` takes the app's own mark. `track` takes the app's own ready track, or `false` when the screen shows the stage elsewhere. `width` takes any CSS width.

```jsx
<Readiness items={[{ text: 'The version is not approved yet.', state: 'proposed' }]} />
```
