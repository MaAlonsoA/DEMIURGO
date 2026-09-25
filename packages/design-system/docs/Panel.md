---
category: Cards
---

The detail size of the card template: a panel for the selected thing, or a floating peek beside a pointed card.

Compose its content from the other pieces: the type and certainty line, the title in the title style, the code in the code style (only here), the description, and actions. `floating` adds the float shadow used for peeks.

`width` takes pixels or any CSS width, such as `'100%'` in a column.

```jsx
<Panel floating>
  <TypeIcon type="feature" label />
  <strong className="dm-text-title">Sign up for an activity</strong>
  <Button variant="quiet">Review</Button>
</Panel>
```
