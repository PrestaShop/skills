# Design reference for `report.html`

The report borrows a gallery aesthetic: full-bleed bands that alternate between white, parchment and
near-black, no chrome, one quiet blue for everything interactive, and **exactly one shadow in the
whole system** — reserved for imagery. It is a resemblance, not an implementation: nothing is
fetched, and `scripts/report.js` inlines every value below as one `<style>` block.

Keep this file and that block in step: change a value here and change it there, or this stops being
a reference and becomes a lie.

## Contents

* The one idea to keep
* The opening band earns the read
* Colour
* Type
* Bands, not cards
* The single shadow
* Shape
* Layout and spacing
* Accessibility that applies to a static page
* What the report adds: status colour
* What does not apply here
* What the report must never do

## The one idea to keep

In the source system the photograph is the subject and the interface recedes until the wall
disappears. **A QA report has the same subject/frame relationship: the before/after screenshots are
the argument, and every heading, table and label exists to point at them.** That is why the single
shadow lands on the screenshots and nowhere else, and why sections are separated by a change of
surface rather than by a border.

## Colour

One interactive colour. There is no second accent, and adding one breaks the system.

| Token | Value | Used for |
|:---|:---|:---|
| `--action` | `#0066cc` | every link and every interactive element, on light surfaces |
| `--action-focus` | `#0071e3` | the keyboard focus ring, `outline: 2px solid` |
| `--action-on-dark` | `#2997ff` | links on a dark band, where the action blue disappears |
| `--canvas` | `#ffffff` | the dominant surface |
| `--parchment` | `#f5f5f7` | the alternating light band, and the closing band |
| `--tile` | `#272729` | the dark band |
| `--ink` | `#1d1d1f` | every headline and every paragraph on light surfaces. Near-black, not black — it keeps the page photographic rather than printed |
| `--ink-muted` | `#7a7a7a` | captions, fine print, secondary labels |
| `--on-dark` | `#ffffff` | text on the dark band |
| `--on-dark-muted` | `#cccccc` | secondary text on the dark band, where white would shout |
| `--hairline` | `#e0e0e0` | the 1px border on utility cards and tables. The only line in the system |

## Type

The platform's own interface face, reached through the system stack so nothing is downloaded — on a
Mac it resolves to the real thing, elsewhere it falls back to Inter, then to the generic sans:

```
--sans: system-ui, -apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", Arial, sans-serif;
```

| Role | Size / line | Weight | Tracking |
|:---|:---|:---|:---|
| verdict | 56px / 1.07 | 600 | −0.28px |
| band headline | 40px / 1.10 | 600 | 0 |
| section head | 34px / 1.15 | 600 | −0.374px |
| lead paragraph | 28px / 1.14 | 400 | +0.196px |
| tagline, card title | 21px / 1.19 | 600 | +0.231px |
| body | **17px** / 1.47 | 400 | −0.374px |
| caption, button, table | 14px / 1.43 | 400 | −0.224px |
| fine print | 12px / 1.4 | 400 | −0.12px |

Four rules that carry the voice, and they are not negotiable:

* **Body runs at 17px, not 16px.** The extra pixel is what makes the page read rather than scan.
* **Negative tracking from 17px up**, never at 12px or below.
* **The weight ladder is 300 / 400 / 600 / 700. Weight 500 does not exist here.** Mid-weight
  emphasis is 600.
* **Line height 1.47 for body**, and 1.07–1.19 for display sizes. Do not tighten body leading.

## Bands, not cards

Sections are full-bleed bands stacked edge to edge with **no gap and no border**. The change of
surface is the divider — that is the whole structural idea, and adding a rule between two bands
undoes it.

The rhythm across the page: light → parchment → light → dark → light → parchment. Inside every band,
content is constrained and centred; the band itself runs the full width of the window.

The dark band is used once, for the recorded run — the source system reserves near-black for video
frames, and that is exactly what it holds here.

## The single shadow

```css
box-shadow: rgba(0, 0, 0, .22) 3px 5px 30px 0;
```

**It goes on screenshots and on the video, and nowhere else.** Never on a card, never on a button,
never on text. Elevation in the interface comes from the change of surface, not from depth. A card
that needs to be set apart gets a 1px `--hairline` border, and that is the only line the page draws.

## Shape

| Radius | Value | Use |
|:---|:---|:---|
| none | `0` | bands, and screenshots inside a band — they are rectangular, edge to edge |
| sm | `8px` | inline imagery inside a card |
| lg | `18px` | utility cards: the run summary, the not-tested list, the comment block |
| pill | `9999px` | anything that reads as an action or a status: badges, the copy button |

Do not mix grammars: `8px` for compact utility, `18px` for cards, pill for actions, nothing between.

## The opening band earns the read

The first screen decides whether the rest gets read, so it carries four things and nothing else: the
verdict at full size, the one sentence that qualifies it, **the marked region in both states**, and a
row of counted numbers. The evidence arrives before any table does.

* The verdict is a word with a coloured dot, never a coloured band.
* The clipped pair sits directly under it. A reader who stops there has still seen the proof.
* The numbers are counted from the run, never estimated: states measured, steps recorded,
  screenshots kept, checks that can prove the bug, harness errors. Set at 40px/600 over a 14px
  muted caption, on a hairline rule.
* A clipped region is displayed at its own size, never stretched to the column — enlarging a
  200px band into a 480px slot turns crisp evidence into a blur.

## Layout and spacing

* Base unit 8px. Structural steps: 8, 12, 16, 24, 32, 48, **80 for a band's vertical padding**.
* Content max width 980px for text, 1440px for wide tables; a band's own width is the window.
* At least 64px of air above a band's headline, 48px below.
* Nothing sits closer than 40px to a screenshot. The evidence needs room or it stops reading as
  evidence.
* Card padding 24px. Gutters between cards 20–24px.
* Tables: left-aligned, 1px `--hairline` separators, no vertical rules, no zebra, `tabular-nums`.

## Accessibility that applies to a static page

* Focus is visible: `outline: 2px solid var(--action-focus)`. `outline: none` is never used without
  a replacement.
* Every screenshot carries a real `alt` naming the step and the phase. The verdict's coloured dot is
  decorative — the word beside it carries the meaning — so it is `aria-hidden="true"`.
* Status is never colour alone: every verdict and every row writes the word.
* Buttons press with `transform: scale(0.95)`, and that is the only motion on the page. It is
  wrapped in `prefers-reduced-motion: no-preference`.
* `color-scheme: light` is declared: the page commits to a light gallery, and without it a dark-mode
  browser paints scrollbars and video controls in a palette the page never accounted for.

## What the report adds: status colour

The source system has exactly one accent and no notion of pass or fail. A verdict needs both, so the
report adds a status set — and spends it as sparingly as possible. **Status never washes a whole
band.** It appears as a small dot beside the verdict word, and as the text colour inside otherwise
neutral pills.

| Meaning | Colour |
|:---|:---|
| approved, passed | `#1d8a4e` |
| not approved, failed | `#c8102e` |
| warning, pre-existing | `#8a6100` |
| neutral information | `--action` |

## What does not apply here

The source describes a product catalogue and a store. `report.html` is one static document opened
from disk, so most of that has nothing to act on: navigation bars, sub-navigation, sticky bars,
configurator chips, search inputs, product grids, carousels, price rows, responsive art direction,
`srcset`. Skipping them is the point — the system's own instruction is to reach for a change of
surface before adding chrome, and a report needs less chrome than a store, not more.

## What the report must never do

* No absolute paths, no credentials, no environment variables — the file gets attached to tickets.
* No second accent colour, no gradient, no decorative frame.
* No shadow on anything that is not a screenshot or the video.
* No external request: no CDN, no font host, no analytics. Nothing but the files next to it.
* No claim the run did not measure. If a phase is missing, the section says it is missing.
