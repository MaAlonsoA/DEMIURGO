# Building with the DEMIURGO design system

Build with the components on `window.Demiurgo` for everything the visual language defines, and use the `dm-*` classes and the tokens (as `var(--paper)`) only for your own layout glue. Never invent class names or colors.

## Setup

No provider or wrapper. `styles.css` loads the fonts (Instrument Sans, JetBrains Mono), every token on `:root` and every `dm-*` class. It also sets `body` to the `--paper` ground with `--ink` text at 14px. Design desktop first at 1440 × 900: `Header` on top, content on `--paper`, a right column of about 380px.

## Components (window.Demiurgo)

| For | Use |
|---|---|
| How sure (every element) | `CertaintyDot state="confirmed" \| "assumed" \| "proposed" \| "open" \| "unknown"`; `StatusMark status="parked" \| "dropped" \| "replaced" \| "out-of-date" \| "conflict"` |
| How far (features only) | `StageBars stage="not-ready" \| "ready" \| "building" \| "verified" \| "in-doubt"` |
| Who did it | `WhoMark who="you" \| "demiurgo" \| "agent" \| "automatic"` |
| What it is | `TypeIcon type="feature" \| "decision" \| "tech-decision" \| "question" \| "check" \| "idea" \| "thread" \| "journey"` |
| Attention and state | `NeedsYou count`, `Working`, `Signal kind` |
| Actions | `Button variant="primary"` (one per view) \| `"secondary"` \| `"quiet"` \| `"text"`; `Chip pressed`; `Choice options value` |
| Things | `FeatureCard` (146px card), `Node` (44px row), `Panel` (detail; `floating` for a peek), `Tooltip`, `Legend` |
| Screens | `Header`, `Readiness`, `Proposal`, `WhileAway`, `CheckRow` |

Each component's `.prompt.md` has its props and an example.

## Rules

- Proposed (blue ring) never looks like Confirmed (filled ink): only a person confirms.
- Color has one meaning each:
  - blue (`--needs`) means something needs the person: the `NeedsYou` counter, the primary action, Proposed and the selection;
  - amber (`--working`) means someone is working now;
  - rust (`--problem`) is a conflict, something blocked or in doubt.
- One phrase asks for attention: "Needs you". Names before codes; codes only in a `Panel`, with `dm-code`. English, sentence case, no emoji.

## Layout glue

Tokens: `--paper`, `--surface`, `--line`, `--line-soft`, `--ink`, `--ink-2`, `--ink-3`, `--muted`, `--space-1` to `--space-12`, `--radius-card-md`, `--radius-card`, `--radius-panel`, `--shadow-float`. Text classes: `dm-text-page-title`, `dm-text-title`, `dm-text-heading`, `dm-text-body`, `dm-text-small`, `dm-text-caption`, `dm-label`.

## Where the truth lives

`_ds_bundle.css` has every token (with a usage comment) and every class. `guidelines/guides/` holds:
- `00-brand-book.md`: the rules;
- `10-journeys.md`: the flows that were designed;
- `20-h1.md`: what H1 builds;
- `30-words.md`: how back-end states become words and marks;
- `40-screens.md`: the reference screens.

## Example

```jsx
const { FeatureCard, Signal } = window.Demiurgo;
<div style={{ display: 'flex', gap: 'var(--space-5)', padding: 'var(--space-6)' }}>
  <FeatureCard state="proposed" stage="not-ready" needs={1} title="Sign up for an activity"
    line="A member takes a place in one step." who="demiurgo" when="18:52"
    signals={<Signal kind="assumptions" value={1} />} />
</div>
```
