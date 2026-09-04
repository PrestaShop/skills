# Design reference for `report.html`

The report borrows a gallery aesthetic: full-bleed bands that alternate between white, parchment and near-black, no chrome, one quiet blue for everything interactive, and **exactly one casting shadow in the whole system**, reserved for imagery. It is a resemblance, not an implementation: nothing is fetched, and `scripts/report.js` inlines every value below as one `<style>` block.

Keep this file and that block in step: change a value here and change it there, or this stops being a reference and becomes a lie.

## Contents

* The one idea to keep
* Colour
* Type
* Code, badges and labels
* Bands, not cards
* The single shadow
* Shape
* The opening band earns the read
* Layout and spacing
* Accessibility that applies to a static page
* What the report adds: status colour
* What does not apply here
* What the report must never do

## The one idea to keep

In the source system the photograph is the subject and the interface recedes until the wall disappears. **A QA report has the same subject/frame relationship: the before/after screenshots are the argument, and every heading, table and label exists to point at them.** That is why the single shadow lands on the screenshots and nowhere else, and why sections are separated by a change of surface rather than by a border.

## Colour

One interactive colour. There is no second accent, and adding one breaks the system.

| Token | Value | Used for |
| --- | --- | --- |
| `--action` | `#0066cc` | every link and every interactive element, on light surfaces |
| `--action-focus` | `#0071e3` | the keyboard focus ring, `outline: .125rem solid` |
| `--action-on-dark` | `#2997ff` | links on a dark band, where the action blue disappears |
| `--canvas` | `#ffffff` | the dominant surface |
| `--parchment` | `#f5f5f7` | the alternating light band, and the closing band |
| `--tile` | `#272729` | the dark band |
| `--ink` | `#1d1d1f` | every headline and every paragraph on light surfaces. Near-black, not black, which keeps the page photographic rather than printed |
| `--ink-muted` | `#6b6b70` | captions, fine print, secondary labels |
| `--on-dark` | `#ffffff` | text on the dark band |
| `--on-dark-muted` | `#cccccc` | secondary text on the dark band, where white would shout |
| `--hairline` | `#e0e0e0` | the `.0625rem` border on utility cards and tables. The only line in the system |

## Type

The platform's own interface face, reached through the system stack so nothing is downloaded. On a Mac it resolves to the real thing, elsewhere it falls back to Inter, then to the generic sans:

```
--sans: system-ui, -apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", Arial, sans-serif;
--mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
```

**Every length is in `rem`, and every tracking in `em`.** A page whose sizes are in pixels ignores a reader who has set a larger default; `rem` follows it, and `em` is the only unit that makes tracking follow the size of the text it applies to.

| Role | Size / line | Weight | Tracking |
| --- | --- | --- | --- |
| verdict | `3.5rem` / 1.07 | 600 | `-.005em` |
| band headline | `2.125rem` / 1.15 | 600 | `-.011em` |
| lead paragraph | `1.75rem` / 1.14 | 400 | `.007em` |
| card title | `1.3125rem` / 1.19 | 600 | `.011em` |
| body | `1.0625rem` / 1.47 | 400 | `-.022em` |
| caption, table, badge | `.875rem` / 1.43 | 400 | `-.016em` |
| fine print, phase tag | `.75rem` / 1.4 | 400 | `-.01em` |

Four rules carry the voice, and they are not negotiable:

* **Body runs at `1.0625rem`, not `1rem`.** The extra pixel is what makes the page read rather than scan.
* **Negative tracking from body size up**, never on the small print.
* **The weight ladder is 400 / 500 / 600. Nothing lighter, nothing bolder.** Mid-weight emphasis is 600.
* **Line height 1.47 for body**, and 1.07 to 1.19 for display sizes. Do not tighten body leading.

## Code, badges and labels

Three small components carry most of the page's information, and each one failed a first draft by being too quiet.

**Code has its own ground.** Monospace alone does not separate `runnerSha256` from the prose around it at a glance. It sits on `rgba(0, 0, 0, .045)`, at weight 500, `.875em` so it follows whatever text surrounds it, with `.25rem` corners and `.0625rem .3125rem` of padding. Inside a `pre` the ground is dropped, because the block already has one.

**A badge is tinted, not merely coloured text.** A word in a slightly darker grey is not a status, it is a typo waiting to be missed. Each state gets a pale ground, its own text colour and a hairline ring in the same hue at 28% opacity. On the dark band the tints would vanish, so the ground becomes translucent white and the status colour is lightened rather than dropped: a badge that loses its colour on one surface has stopped being a badge.

**A caption and a phase label must not read alike.** The `figcaption` names the pair and is ink at body size, weight 600, with a hairline under it. The phase label, `before` or `after`, is a small monospace tag on the same ground as inline code. One is a title, the other is a tag on a picture.

**A folded section is a control.** `summary` gets `.75rem` of vertical padding so it can be clicked without aiming, consecutive `details` are separated by `.75rem`, and an open one puts a hairline under its summary with `1.5rem` before the content. Without that, two collapsed sections read as two stray rules with text between them.

## Bands, not cards

Sections are full-bleed bands stacked edge to edge with **no gap and no border**. The change of surface is the divider. That is the whole structural idea, and adding a rule between two bands undoes it.

The rhythm across the page: light → parchment → light → dark → light → parchment. Inside every band, content is constrained and centred; the band itself runs the full width of the window.

The dark band is used once, for the recorded run. The reference reserves near-black for video frames, and that is exactly what it holds here.

## The single shadow

One shadow casts. The `inset` rings on badges are drawn with `box-shadow` too, but an inset ring is a hairline, not elevation, so it does not count against this rule and must never be given a blur that reads as one.

```css
box-shadow: rgba(0, 0, 0, .22) .1875rem .3125rem 1.875rem 0;
```

**It goes on screenshots and on the video, and nowhere else.** Never on a card, never on a button, never on text. Anything carrying it keeps `.5rem` of margin below, so the blur has somewhere to fall instead of touching the next element. Elevation in the interface comes from the change of surface, not from depth. A card that needs to be set apart gets a `.0625rem` `--hairline` border, and that is the only line the page draws.

## Shape

| Radius | Value | Use |
| --- | --- | --- |
| none | `0` | bands, and screenshots inside a band. Both are rectangular, edge to edge |
| sm | `.5rem` | inline imagery inside a card |
| lg | `1.125rem` | utility cards: the run summary, the not-tested list, the comment block |
| pill | `62.4375rem` | anything that reads as an action or a status: badges, the copy button |

Do not mix grammars: `.5rem` for compact utility, `1.125rem` for cards, pill for actions, nothing between.

## The opening band earns the read

The first screen decides whether the rest gets read, so it carries four things and nothing else: the verdict at full size, the one sentence that qualifies it, **the marked region in both states**, and a row of counted numbers. The evidence arrives before any table does.

* The verdict is a word with a coloured dot, never a coloured band.
* The clipped pair sits directly under it. A reader who stops there has still seen the proof.
* The numbers are counted from the run, never estimated: states measured, steps recorded, screenshots kept, checks that can prove the bug, harness errors. Set at `2.5rem`/600 over a `.875rem` muted caption, on a hairline rule.
* A clipped region is displayed at its own size, never stretched to the column. Enlarging a `12.5rem` band into a `30rem` slot turns crisp evidence into a blur.

## Layout and spacing

* Base unit `.5rem`. Structural steps: `.5`, `.75`, `1`, `1.5`, `2`, `3`, and **`5rem` for a band's vertical padding**.
* Content max width `61.25rem` for text; a band's own width is the window.
* At least `4rem` of air above a band's headline, `3rem` below.
* Nothing sits closer than `2.5rem` to a screenshot. The evidence needs room or it stops reading as evidence.
* Card padding `1.5rem`. Gutters between cards `1.5rem`.
* Screenshots stay relative paths into the run directory, and each links to itself so a click opens it full size. `loading="lazy"` on every one, so a report with forty of them still opens instantly.
* Tall narrow captures are capped at `26.25rem` with `object-fit: contain` anchored to the top, where layout breaks show. Without the cap, one phone screenshot fills a screen and a half.
* Tables: left-aligned, `.0625rem` `--hairline` separators, no vertical rules, no zebra, `tabular-nums`. Each one scrolls inside its own container, so the page body never scrolls sideways.

## Accessibility that applies to a static page

* Focus is visible: `outline: .125rem solid var(--action-focus)`. `outline: none` is never used without a replacement.
* Every screenshot carries a real `alt` naming the step and the phase. The verdict's coloured dot is decorative, since the word beside it carries the meaning, so it is `aria-hidden="true"`.
* Status is never colour alone: every verdict and every row writes the word.
* Buttons press with `transform: scale(0.95)`, and that is the only motion on the page. It is wrapped in `prefers-reduced-motion: no-preference`.
* `color-scheme: light` is declared: the page commits to a light gallery, and without it a dark-mode browser paints scrollbars and video controls in a palette the page never accounted for.

## What the report adds: status colour

The source system has exactly one accent and no notion of pass or fail. A verdict needs both, so the report adds a status set, and spends it as sparingly as possible. **Status never washes a whole band.** It appears as a small dot beside the verdict word, and as the text colour inside otherwise neutral pills.

| Meaning | Text | Ground | Ring | On the dark band |
| --- | --- | --- | --- | --- |
| approved, passed | `#1d8a4e` | `#e6f4ec` | the text colour at 28% | text `#5fd39a` on white at 16% |
| not approved, failed | `#c8102e` | `#fbe9ec` | the text colour at 28% | text `#ff8a95` on white at 16% |
| warning, pre-existing | `#8a6100` | `#fdf3e0` | the text colour at 28% | text `#ffc154` on white at 16% |
| neutral information | `#0066cc` | `#e8f0fb` | the text colour at 22% | text `#2997ff` on white at 16% |

## What does not apply here

The source describes a product catalogue and a store. `report.html` is one static document opened from disk, so most of that has nothing to act on: navigation bars, sub-navigation, sticky bars, configurator chips, search inputs, product grids, carousels, price rows, responsive art direction, `srcset`. Skipping them is the point: the reference's own instruction is to reach for a change of surface before adding chrome, and a report needs less chrome than a store, not more.

## What the report must never do

* No absolute paths, no credentials, no environment variables. The file gets attached to tickets.
* No second accent colour, no gradient, no decorative frame.
* No shadow on anything that is not a screenshot or the video.
* No external request: no CDN, no font host, no analytics. Nothing but the files next to it.
* No claim the run did not measure. If a phase is missing, the section says it is missing.

