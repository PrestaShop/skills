# Writing a suite

One suite per checklist section. It is written for the campaign, kept in the campaign folder, and
run unchanged on every cell of the matrix so the results can be compared.

## Contents

* What a suite looks like
* Everything a suite is handed
* What a machine may settle, and what it may not
* Checks that pass for the wrong reason
* Reusing a suite from a previous campaign

## What a suite looks like

```js
module.exports = {
  section: '3.2',
  title: 'Category and listings',

  async run({ url, viewport, profile, step, observe, open, see, count, page,
              moduleRenders, noPageErrors, overflow, contrast, accessibility }) {
    await step('open a category', async () => {
      await open('/index.php?controller=category&id_category=3', '3.2/01');
    });

    await step('the product miniatures', async () => {
      await count('3.2/09', '.product-miniature', { min: 1 });
      await see('3.2/09', '.product-miniature .product-price', 'the price on a miniature');
    });
  },
};
```

Four things every check does, and a check that does not do them is not a check:

1. **Name the checklist point it answers**, as its first argument. Coverage is recorded, never
   inferred, and a point nothing names comes out as not covered.
2. **Say what it looked for.** A pass without that is refused by `record.js` on the spot, because
   the report is built out of these sentences and "it passed" is not one.
3. **Run inside a `step()`, and keep the step small.** The step is what photographs the shop, and
   that photograph is what a green leans on when the check names no file of its own. A check
   called outside every step has nothing behind it, and `report.js` refuses to print it as
   settled. The picture is taken when the step ends, so a step that opens a page, checks it, then
   navigates somewhere else leaves its first check pointing at the second page: one subject per
   step, and `snap()` for a check that needs its own picture. A step that threw is photographed
   after it broke, so it lends its picture to nothing.
4. **Leave a file behind** when a person will have to look.

## Everything a suite is handed

| Name | What it does |
| --- | --- |
| `step(name, fn)` | numbers the step, labels it in the recording, runs it, settles, takes a screenshot. A throw inside is a fault in the run, never a failure of the theme |
| `observe(item, outcome, opts)` | records one answer. `outcome` is `pass`, `fail`, `needs-human`, `inconclusive` or `skipped` |
| `open(target, item?)` | goes to a page and, when given a point, settles whether it answered and is not an error page |
| `see(item, selector, what)` | settles whether something is on the page and **really** visible: it has a box, and no ancestor hides it |
| `count(item, selector, {min, max})` | settles how many things match. Zero matches is recorded as inconclusive, never as a quiet pass |
| `moduleRenders(item, module, selector, where)` | tells a module with nothing configured from a module whose hook is dead. See below |
| `noPageErrors(item)` | settles whether anything broke in the console and whether everything the pages asked for arrived |
| `overflow(item, where)` | **measures** sideways scrolling and the boxes sticking out |
| `contrast(item, where)` | **measures** colour contrast, and says how much could not be judged |
| `accessibility(item, where)` | settles the automatic accessibility rules, naming the element that broke each one |
| `focusRing(item, selector, what)` | **measures** whether a control looks different once it takes focus |
| `imageScale(item, where)` | **measures** whether images are asked for more pixels than they have |
| `loginBO(item)` | signs into the back office with the credentials in the environment |
| `settle()` | waits for the network, the fonts and the animations. Never a fixed wait |
| `snap(name)` | takes an extra screenshot and gives back its name, for evidence |
| `settingOpened({setting, was, set, where})` | writes down a shop-wide setting **before** it is changed, so a run that dies in the middle still says what to put back |
| `settingRestored(entry, readBack)` | ends it, having read the value back from the shop. A restore nobody could confirm is a failure, not a success |
| `fixtureCreated({what, how, id, why})` | writes down a record the suite is about to make up. `why` names the checklist point that needs it |
| `fixtureRemoved(entry, stillThere)` | ends it, having read back whether it really went |
| `fixtureLeft(entry, reason)` | ends it the other way, for a record that cannot be taken away |
| `note(text)` | writes a line into the run for a reader, deciding nothing |
| `fault(text)` | says the run itself went wrong. It lands in the report's own section and makes the run exit 2 |
| `page`, `context` | the browser itself, for anything the helpers do not cover |

A screenshot that could not be taken is never silent: `step()` and `snap()` both turn it into a
fault, because a green whose picture went missing is exactly the claim this report promises never
to make.

A setting a suite changes belongs in `settingOpened` and `settingRestored` rather than in a file
the suite writes itself: only those two reach the report's own settings section, which is where a
reader looks to see whether the shop was left as it was found.

`moduleRenders` exists because a module that shows nothing is two situations wearing one face:
it has nothing configured, which the checklist explicitly asks to test, or its hook is not
firing, which is a defect. It reports which of the module's own files loaded and whether any
markup came out, and hands the choice to a person. Recording that as a failure is a false red,
and false reds are what stop a report being read.

It tells a third situation apart as well: markup that exists but is not really visible. On a
narrow screen that is nearly always a drawer or an accordion still closed, so it is reported as
something to look at rather than as missing markup. Saying "no markup" about a node that is
sitting right there sends the reader hunting a dead hook that does not exist.

## What a machine may settle, and what it may not

Three buckets. The middle one is the one that keeps the report honest.

**Settle it.** The page answered and is not an error page. Nothing broke in the console. Nothing
the page asked for is missing. Something is there and really visible. A flow completes: the cart
count changes and the cart lists the product, checkout reaches a confirmation with an order
reference, a search for a catalogue term returns something whose name contains it. Arithmetic:
the total equals the lines plus shipping. An empty required field blocks the form and the page
does not move on. The burger shows below the breakpoint and the menu above it. Tab reaches a
named control and does not get stuck. An automatic accessibility rule is broken.

**Measure it, then let a person decide.** These look automatable and are not. A measured check
is recorded as `needs-human` with the number and a screenshot, **never as a pass**:

| Point | Why |
| --- | --- |
| no sideways scrolling | a fixed menu parked off-screen gives the same number as a real overflow, and the same CSS overflows by about 15 pixels on a desktop with a visible scrollbar and by nothing under phone emulation. Measure after the fonts have landed, report the number and the worst boxes |
| colours have enough contrast | the checker only judges plain text on a plain background. Text over a photo, a gradient or a see-through layer comes back "cannot tell", which is exactly where a theme puts its hero and its tiles. A violation is a failure; "cannot tell" is for a person. Never report zero violations as "contrast passes", and say that hover, focus and disabled states were not visited |
| the focus outline is visible | themes draw it with a shadow, a border or a pseudo-element, so reading `outline` proves nothing. Photograph the control, Tab to it, let the transition finish, photograph again, and say whether anything changed. Whether the change is strong enough is a judgement |
| images are not stretched | compare against the pixels the screen has, never against CSS width, or every image on a dense phone screen reads as stretched. Skip images not loaded yet, and report the ratio |
| no flash of unstyled page | it is over before a settled page can be photographed. Grab early frames and let a person watch them |
| Lighthouse | scores move run to run on a fresh shop with demo data. Record, never fail on them |
| the alt text is meaningful | only its presence can be settled. Claiming the second from the first is the most common accessibility lie |
| VoiceOver, "looks cramped", "reads well" | a person, always |

**Not covered, with a reason.** Emails, unless a mail catcher is part of the shop that was
described. Real payment providers: only cheque, bank wire and cash on delivery can be driven.
A module switched off by default, until someone switches it on.

## Making up the data a point needs

Some points cannot be answered on the data the shop has. A suite may create what it needs, and
the rules are in [environment.md](environment.md). In short: look first, because a demo install
already carries most of it; make it through the back office or the front office rather than by
writing to the database, or the theme will look broken when it is not; name it so it is
recognisable; and end every one of them, either removed and read back, or left on purpose with
the reason. A record that is neither stops the report from building.

Make the narrowest thing that answers the point. A new product changes every listing count and
breaks the checks for an empty listing and for a listing with one product, so changing an
existing product beats adding one.

## When the checklist point is the thing that is wrong

Sometimes the check fails and the theme is right: the point names a back office tab that was
renamed, a setting that moved, a hook that is no longer used. The checklist calls this kind
`Checklist`, and it is a defect of the checklist, not of the theme.

```js
observe('3.4/03', 'inconclusive', {
  reason: 'this point names a back office tab that is not there any more, so nothing about the theme was settled',
});
```

`inconclusive`, never `fail`: the theme did nothing wrong, and a red here would be counted
against a release for no reason. Then add the correction to `checklistCorrections` in
`campaign.json`, where the report prints it in its own section, and open no ticket: the fix is a
line in `docs/qa/testing-checklist.md`.

The section this most often bites is 3.4, whose product tabs, and section 4, whose settings, were
both transcribed from a running back office. The checklist says so itself, in its section 9: a
renamed tab or a moved field invalidates a row silently.

## Checks that pass for the wrong reason

Each of these has cost a real run somewhere.

* **A selector matching nothing makes every "is absent" check pass.** Anything you depend on goes
  through `count()`, which records a zero match as inconclusive instead of green.
* **A module switched off renders nothing**, so every check for something inside it passes over
  an empty page. Use `moduleRenders`.
* **A control inside a closed drawer reads as "hidden by a parent."** On a narrow screen the
  search box, the language and currency pickers and the contact details live in drawers. Open the
  drawer, which is the mobile check the checklist is asking for, rather than reporting the drawer
  working as a defect.
* **An element's own `display` says nothing about a hidden ancestor**, and a panel held off-screen
  by a transform keeps its full height. `see()` asks the browser, not the style.
* **`element.focus()` proves nothing about keyboard access.** Walk `Tab` from the top and see
  where focus lands.
* **A focus ring read before transitions finish is not there yet.**
* **Icon font glyphs live in a private area of Unicode** and never match a text check.
* **An attribute with no visible effect is not a feature.** Check the attribute and what a person
  sees.

## Reusing a suite from a previous campaign

A suite is worth keeping. Before reusing one, compare the checklist it was written against with
the one in hand:

```bash
node "$SKILL_DIR/scripts/checklist.js" --diff old-checklist.json checklist.json
```

Points are matched on their text, not their position, so an added line shows up as one addition
and a list of moves rather than as silent renumbering. Read the moves before reusing the suite:
every one of them is a point whose name changed under a check that still uses the old one.
