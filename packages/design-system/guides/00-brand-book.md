# DEMIURGO brand book

DEMIURGO guides a product from an idea to working software. The AI proposes; only a person confirms, and every screen shows which is which. The product being designed is the center of the interface. The conversation with DEMIURGO is a tool attached to whatever is selected, never the center. Attention is a budget: DEMIURGO asks only what it needs, one thing at a time, and says when you can leave.

The reference screens for everything below are in the Screens groups, and the decisions behind them are in the sections that follow this one.

## Content

- Write for a builder who is not technical. Use product words: Feature, Decision, Tech decision, Check, Thread, Question, Source. Record codes such as `FDR-DIS-001` appear only in the detail, small, in the `code` style.
- Ask for attention with one phrase only: **Needs you**, always with the `needs` counter. Never "Waiting for you" or "Action required".
- Buttons say what happens: "Accept", "Ratify", "Draft it", "Catch up", "Looks right". A confirmation names its effect.
- When something can't be done, show the reasons as the back end gives them, next to the action, and say what the person can do next. Never a bare "Error".
- Say when nothing needs the person: "Nothing needs you. You can close DEMIURGO."
- Sentence case. No exclamation marks, no emoji. The interface is in English; the person's own records keep the language they were written in.
- Quote the person's own words when something comes from them, and mark what an agent says as its own, with its sources marked unverified.

Real copy: "While you were away", "Nothing was built, and nothing you confirmed was changed.", "Before it can be built", "Ready to build", "Out of date: a newer import replaced it", "DEMIURGO won't pick for you."

## Visual foundations

**Dots say how sure. Bars say how far. Color says what it asks of you. Icons say what it is.**

### Color

- The ground is `paper`. Objects sit on `surface` with a `line` border. Dividers inside a card use `line-soft`; controls use `line-strong`.
- Text: `ink` for titles and body, `ink-2` for secondary text, `ink-3` for descriptions, `muted` for labels and metadata. Use `inactive` only for marks and short grey words, never for body text.
- `needs` (blue) means one thing: something needs you. It paints the Needs you counter, the Proposed dot, the primary action and the selection outline, and nothing else. Blue words use `needs-strong`; items that need you sit on `needs-soft` with a `needs-line` border.
- `working` (amber) means someone is working on it right now. Its words use `working-text`, its halo `halo-working`, and the building bar `working-bar`.
- `problem` (rust) marks a problem: a conflict, something blocked, a stage in doubt. Use `problem` for words and icons, `problem-fill` for bars, `problem-soft` behind clashing words.
- Grey (`inactive`, `inactive-soft`, `track`) means inactive: parked, dropped, replaced, out of date, an empty bar.
- Confirmed and Assumed have no color of their own. Assumptions travel as a ◐ signal to whatever rests on them, and an Assumed lens shows them on demand. A signal takes the color of its most urgent part.

### Certainty (CertaintyDot)

One dot and one word on every element: Confirmed (filled `ink`), Assumed (half), Proposed (blue ring), Open (dashed), Unknown (?). Grey marks replace the dot when something stops being active: Parked, Dropped, Replaced, Out of date (StatusMark). An agent's proposal never carries the Confirmed dot.

### Stage (StageBars)

Only features carry a three-bar track, ready · built · verified, right after their dot. Empty is not ready; the first bar in `ink` is Ready to build; the second in `working-bar` is building; all three in `ink` is verified; the first in `problem-fill` means the stage is in doubt. No text on the card: the word shows when you point at the track.

### Who (WhoMark)

You (the only one who confirms), DEMIURGO (drafts, asks, proposes; pointing shows the model), Agent (from outside, only proposes) and Automatic (a rule, the import, a test). Every line of a story, every message and every card footer says who.

### Cards (Card)

One template for every type, with six fixed zones: what it is, how sure and how far, Needs you, title and one line, who and when, signals. Three sizes: node (44px, lists and trees), card (146px, map and overview) and detail (panel, when selected). The border follows the dot: solid, dashed when open, faded when inactive, and a 2px `needs` border with `ring-selected` when selected. Signals show only what is not zero, at most four.

### Point, peek, keep (Peek)

Point at a mark for a tooltip; point at a card for a floating detail beside it, while the map lights up its connections; click to pin it to the right panel; Open for the full page. The same works with Tab and focus; on touch, one tap peeks and a second pins.

### Legend (Legend)

A legend of the marks on the current screen sits 24px from the bottom-left corner. It starts open on the first screens, folds into an ⓘ with "Got it", opens again with the ? key, and announces marks that are new to the person.

### Type

Instrument Sans (Google Fonts) for everything; JetBrains Mono for record codes only. Use `display` for reference titles, `page-title` for the thing in focus, `title` in a detail panel, `heading` for card titles, `body` for running text, `small` for one-line descriptions, `caption` for metadata, and `label` in uppercase for type words and section labels. The header wordmark uses `wordmark`.

### Space, radius and elevation

Space in steps from `space-1` (4px) to `space-12` (48px); cards pad `space-4`, grids gap `space-5`. Radius goes by role: `radius-bar` for bars, `radius-control` for buttons and nodes, `radius-card-md` for cards, `radius-card` for sections and popovers, `radius-panel` for details and peeks, `radius-pill` for the counter, chips and the legend button. Shadows are only for things that float: `shadow-raised` for the legend button and pinned cards, `shadow-float` for peeks and popovers. Keyboard focus is `ring-focus`, which also cross-highlights a legend entry and its marks.

### Layout

Desktop first at `artboard-width` × 900. A `header-height` header on `surface`, the page on `paper`, and a right column of about `aside-width` for Needs you, context and readiness. Phones, at most, check and approve.

## Iconography

Stroke icons on a 24 grid with round caps and joins, in `currentColor`: type icons at 1.8 stroke (Feature, Decision, Tech decision, Question, Check, Idea, Thread, Journey), signal icons at 2 stroke (Depends on, Conflict, Needs review, Blocked, Out of date). The Icons group has them all, drawn in `ink`. No emoji and no icon library.

## Not in this system yet

A dark theme, the final visual direction (the look is neutral on purpose) and mobile layouts.
