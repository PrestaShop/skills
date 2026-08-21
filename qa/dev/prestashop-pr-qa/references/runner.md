# The runner and the scenario

## Contents

* Two files, two lifetimes
* Running a phase
* What a phase leaves behind
* What a scenario is handed
* Viewports and the responsive net
* Bug assertions, and what a flake means
* Exit codes
* `scenario.js` — written fresh for each PR
* The tokens the diff adds
* Checks that pass for the wrong reason

## Two files, two lifetimes

| File | Where it lives | Lifetime |
|:---|:---|:---|
| `scripts/run.js` | ships with the skill | never edited for a run; its hash goes into every `phase.json` as `runnerSha256` |
| `scenario.js` | written into the run directory | rewritten for every PR; its hash goes in as `scenarioSha256` |

`run.js` records; it does not judge. It knows nothing about "approved". Keeping the judge fixed and
the scenario variable is what makes two phases comparable: if either hash differs between them, they
were not the same experiment, and there is no verdict.

## Running a phase

Playwright is the only dependency. `scripts/playwright-lab.sh` reuses one already on the machine or
installs one into a throwaway lab under `$TMPDIR` — never into the shop or the repository, where a
`node_modules/` would end up in a pull request.

```bash
NODE_PATH=$(sh "$SKILL_DIR/scripts/playwright-lab.sh"); export NODE_PATH

cd "$RUN"   # every relative path below then stays inside the run directory
node "$SKILL_DIR/scripts/run.js" --scenario=./scenario.js --phase=before --out=. \
  --url="$FO_URL" --bo-url="$BO_URL"
```

Three things worth knowing about that command:

* `--out=.` is the run directory. The runner appends the phase name itself, so `--phase=before`
  writes into `before/`. Passing `--out=./before` would nest it twice. It **empties** that phase
  directory before measuring, so a screenshot from an earlier pass is never cited as this run's.
* Invoke it with `node` and a path, never as an executable: an installer may write the file without
  the execute bit.
* Run headless. Video recording works headless, and `--headed` needs the full Chromium build, which
  is often absent. If the user wants to watch, print `npx playwright install chromium` and let them
  decide rather than starting a download on their machine unannounced.

Keep every `cd` inside a subshell when you are not in the run directory for good: a bare `cd` moves
the session out of the repository and breaks the `git` and `gh` commands that follow.

## What a phase leaves behind

`video.webm`, one `NN-slug.png` per step taken after the page settled, and `phase.json`:

| Field | What it is |
|:---|:---|
| `phase`, `url`, `boUrl`, `viewport`, `playwright`, `startedAt`, `finishedAt` | the conditions of the measurement |
| `scenarioSha256`, `runner`, `runnerSha256` | what ran, and which program judged it — the two hashes the report compares across phases |
| `preconditions` | `assert.ok` results. One failure and the phase is unusable |
| `bugs` | `assert.bug` results. `passed: true` means CORRECT behaviour was observed |
| `details` | `assert.detail` results. Information, never proof |
| `steps` | one row per `step()`: number, name, screenshot, duration, and how many console or network problems appeared during it |
| `smoke` | the fixed regression net: front page, a product page, the cart, the back office |
| `responsive` | one row per page per narrow viewport: `responds`, `rendered`, `overflowPx`, the boxes that stick out, and a screenshot |
| `consoleErrors`, `netErrors` | everything the page reported, whether the scenario looked or not |
| `notes` | what the run wants the report to say out loud, flakes included |
| `harness` | faults that void the verdict |

`phase.json` deliberately does not carry the process argv. Credentials reach the runner only
through `QA_BO_EMAIL` / `QA_BO_PASSWORD`, and the report is a file people paste into GitHub.

## What a scenario is handed

`run({ page, context, phase, url, boUrl, step, assert, count, settle, loginBO, note, preflight })`:

| Name | Contract |
|:---|:---|
| `step(name, fn)` | numbers the step, shows it in the video HUD, runs `fn`, settles, screenshots. A throw inside is a harness error, not a failed PR |
| `assert.ok(name, cond, detail)` | a precondition. It must hold in BOTH phases |
| `assert.bug(name, cond, detail)` | the only thing that can prove the bug. `cond` and `detail` may be async functions — see below |
| `assert.detail(name, cond, d)` | information only. Markup the PR adds belongs here, never in a bug assertion |
| `count(sel, {min, max})` | asserts how many nodes a selector matches, and returns the locator. A selector matching nothing is a harness error, not a passing "is absent" check |
| `settle()` | waits for the network and the animations. Never `waitForTimeout` |
| `preflight(resp, label)` | records a navigation's status and whether the body is a fatal page. Applied automatically to every document navigation |
| `loginBO()` | logs into the back office with the environment credentials, then asserts that it worked |
| `note(text)` | one line for the report |

## Viewports and the responsive net

A scenario runs at 1280×900 by default. When the ticket is about mobile — *"on my phone the menu
does not close"* — declare it, so the bug is measured where it was reported:

```js
module.exports = { name: '...', kind: 'bugfix', where: 'fo', viewport: 'mobile', /* ... */ };
```

`viewport` accepts `desktop` (1280×900), `mobile` (375×812) or `tablet` (768×1024). It changes where
the **bug assertion** is measured, nothing else.

Independently of that, every phase ends with a **responsive net**: the front page plus up to two of
the pages the scenario actually opened, re-visited at 375 and 768 wide. Two widths, always the same,
never derived from the PR — that is what makes the two phases comparable.

The question it answers is *does the shop still work narrow*, not *is the design good*. Three binary
facts per page and width, and nothing else:

| Field | True when |
|:---|:---|
| `responds` | the page returned under 400 and is not a fatal error page |
| `rendered` | `body` is really being rendered and shows more than 20 characters of visible text. Catches a layout hidden at one width — a real mistake, and invisible on desktop |
| `overflowPx` | 0. Above 0, the page scrolls sideways at that width |

`ok` is all three at once. Each is mechanical, so the net never produces a finding a human has to
dismiss. `worst` names up to three visible boxes that stick out, as a hint — `position: fixed`
elements are skipped, because a fixed element cannot make the document scroll, so an off-canvas menu
parked to the right of the viewport is not the culprit.

A screenshot is taken at each width whether or not anything failed: everything a machine cannot
judge — a cramped price, a two-line button, an image out of proportion — is judged by the reviewer
looking at `mobile-*.png` and `tablet-*.png` side by side across the two phases.

## Bug assertions, and what a flake means

Pass `cond` as a function and a failure is re-sampled after settling rather than trusted at once.
**Read the DOM inside that function.** A value captured before the call returns the same reading
twice, so the re-sample proves nothing — that is the one mistake this API invites. `detail` may be
a function too, so the report quotes the reading the verdict actually rests on.

What a flip means depends on the phase, and the runner does not treat the two alike:

| Phase | A flip means | Recorded as |
|:---|:---|:---|
| `before` | the symptom appeared, then cleared: an **intermittent** reproduction | still a reproduction (`passed: false`), plus `flaky` and `intermittent`, plus a note |
| `after` | the fix is in place and the first read was simply too early | the settled reading counts (`passed: true`), plus `flaky`, plus a note |

Neither is a harness error. A flake is reported, never fatal: voiding a verdict because one page
was slow throws away a run that was valid.

## Exit codes

`--phase` accepts only `before` or `after`, and both it and `--url` are required: a typo exits 2
before the browser starts rather than producing a run whose phase is neither.

The exit code says nothing about the PR. `0` means the phase ran cleanly. `2` means the harness
could not produce trustworthy observations — a harness error, or a failed precondition, which voids
the verdict just the same. Bug assertions failing in the `before` phase is the expected outcome,
not an error, and does not change it. Neither does a flake.

## `scenario.js` — written fresh for each PR

```js
/**
 * QA scenario. The SAME file runs in both phases, unchanged — its hash is recorded in each
 * phase.json and a mismatch voids the verdict.
 *
 * Four rules, in order of importance:
 *  1. assert.bug() is the ONLY thing that can prove the bug. Write it in the reporter's words.
 *     Never name a class, id, attribute or file the PR ADDS: in the pre-fix state it is absent,
 *     the check fails, and you would report a reproduction you never made.
 *  2. assert.ok() is a precondition. It must hold in BOTH phases. If one fails, the environment
 *     is unusable and there is no verdict — not a failed PR.
 *  3. Never branch on `phase` for an assertion. Branch on it only to create data the pre-fix
 *     code cannot create on its own, and say so with note().
 *
 *  4. Read the DOM INSIDE an assert.bug callback, never into a variable before the call. The
 *     callback is re-sampled when it fails, and a captured value returns the same reading twice.
 *
 * Every selector goes through count(). No waitForTimeout: use settle().
 */
module.exports = {
  name: 'what the ticket says is wrong, one line',
  pr: 'owner/repo#0000',
  issue: 'owner/repo#0000 or null',
  kind: 'bugfix',          // 'bugfix' | 'feature'
  where: 'fo',             // 'fo' | 'bo' | 'both'
  bug: 'the user-visible symptom, in the reporter\'s words',

  async run({ page, phase, url, step, assert, count, settle, loginBO, note, preflight }) {
    // await step('log in to the back office', async () => { await loginBO(); });

    await step('open the page from the ticket', async () => {
      const resp = await page.goto(`${url}/<path from the ticket>`, { waitUntil: 'domcontentloaded' });
      await settle();
      await preflight(resp, 'the page from the ticket');
      await count('<a selector that exists in BOTH phases>', { min: 1 });
    });

    await step('<the action from the reproduction steps>', async () => {
      const target = await count('<selector present in both phases>', { min: 1 });
      await target.first().click();
      await settle();
    });

    await step('observe the symptom', async () => {
      // Read inside the callbacks, never before them: assert.bug re-samples a failure, and a
      // value captured beforehand hands it the same reading twice — a re-sample that cannot flip.
      const read = async () => (await page.locator('<selector present in both phases>').first().innerText()).trim();
      await assert.bug(
        '<the symptom, in the words of the ticket>',
        async () => (await read()) === '<what a correct shop shows>',
        async () => `observed "${await read()}"`,
      );
      assert.detail('<markup the PR introduces — information only>',
        (await page.locator('<the new selector>').count()) === 1);
    });
  },
};
```

## The tokens the diff adds

Used to catch a bug assertion that only restates the diff:

```bash
gh pr diff "$PR" --repo "$REPO" > env/diff.patch
grep '^+' env/diff.patch | grep -oE '[A-Za-z_][A-Za-z0-9_-]{3,}' | sort -u > env/added
grep '^-' env/diff.patch | grep -oE '[A-Za-z_][A-Za-z0-9_-]{3,}' | sort -u > env/removed
# Renamed things are fair game to mention, so subtract what the diff also removed.
# Then keep only code-shaped names — snake_case, kebab-case, camelCase, PascalCase — because
# plain English words the diff happens to add would otherwise flood the comparison.
comm -23 env/added env/removed | grep -E '_|-|[a-z][A-Z]|^[A-Z]' > env/diff-added-tokens.txt
```

Then check the scenario against it, looking only inside the bug assertions:

```bash
awk '/assert\.bug\(/,/\);/' scenario.js \
  | grep -oE '[A-Za-z_][A-Za-z0-9_-]{3,}' | sort -u \
  | comm -12 - env/diff-added-tokens.txt
```

Any name printed has to be rewritten in user-visible terms before the run. Hits inside
`assert.detail` do not matter — that is what `detail` is for, which is why the check is scoped to
`assert.bug` blocks.

The grep is an aid, not the rule. A single lowercase word the PR introduces — a new class called
`hidden` — slips through it, and the rule still stands: a bug assertion says what the person who
filed the ticket would see.

## Checks that pass for the wrong reason

These are the ways a browser check reports success while proving nothing. Every one has been paid
for at least once.

Four of them the runner now guarantees, so they are listed only so you know they are handled and
do not need guarding again: a document navigation returning 400 or worse, or landing on a fatal
page, is recorded as a failed precondition whether or not the scenario calls `preflight`;
screenshots are taken after `settle()`; and the video is saved by name rather than by picking the
newest file in the directory.

The rest are yours. Nothing in the runner can prevent them, because they are choices made while
writing assertions:

- **A selector matching nothing makes every "is absent" check pass.** `count()` reports it, but only for selectors you actually pass through `count()`. A bare `page.locator()` is unguarded.
- **A diff-derived selector fakes a reproduction.** In the pre-fix state, markup the PR adds is missing; the check fails and looks exactly like the bug. Only user-visible symptoms prove a bug.
- **`element.focus()` proves nothing** about keyboard access. Walk `Tab` from the top and see where focus actually lands.
- **A focus ring read too early is not there yet.** Let transitions finish before measuring outline or box-shadow — `step()` settles at its end, which does not help you mid-step.
- **`event.defaultPrevented` does not prove handling** on a native control: the browser may have acted anyway.
- **An attribute without a visible effect is not a feature.** Assert the attribute *and* what the user sees — the attribute alone belongs in `assert.detail`.
- **Panel height is not visibility.** A drawer hidden by `transform` keeps its full height.
- **An element's own `display` says nothing about a hidden ancestor.** Ask the browser whether it is really visible.
- **Icon-font glyphs live in the Unicode private use area** and are not visible text: they will never match a text assertion.
- **Built assets and `vendor/` do not follow a git checkout.** For themes this is the norm rather than an edge case — see `prestashop.md`, "A theme's built assets do not follow a git checkout".
