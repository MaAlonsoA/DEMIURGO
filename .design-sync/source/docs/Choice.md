---
category: Controls
---

Answering a question: each option says what it changes; DEMIURGO recommends one, and the person picks.

Pass two or three options. Each has a label and the effect of choosing it; one may be `recommended`, with a sentence on `why`. Control it with `value` and `onChange`.

```jsx
<Choice value="Only members" options={[
  { label: 'Only members', effect: 'Others can see activities, but not sign up.', recommended: true, why: 'It matches what you said about the club.' },
  { label: 'Anyone', effect: 'Sign up needs an email, and adds a Visitors list.' }
]} />
```
