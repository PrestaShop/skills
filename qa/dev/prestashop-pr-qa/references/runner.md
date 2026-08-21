# Running the browser

Two files do the work, and they are not the same kind of thing. `run.js` **ships with the skill**
at `scripts/run.js`: it is the invariant part, never edited for a run, and its hash is recorded in
every result. `scenario.js` is written fresh from the PR being tested, into the run directory —
`~/prestashop-pr-qa/[owner]-[repo]-pr-[number]/`, outside the shop and outside every git work tree.
Playwright is the only thing that has to be installed, and it goes in a throwaway lab.

## 1. Stand up Playwright without touching the project

Playwright goes in a throwaway lab, never in the shop or in the repository being tested. Try what
is already on the machine first: a launch probe is a better test than comparing browser revisions
by hand, because it fails for the real reason.

```bash
LAB="${TMPDIR:-/tmp}/ps-pr-qa-lab"

# Prefer a Playwright already present on the machine, with browsers that actually launch.
for CAND in "$LAB/node_modules" "$HOME"/.npm/_npx/*/node_modules; do
  [ -d "$CAND/playwright" ] || continue
  if NODE_PATH="$CAND" node -e "require('playwright').chromium.launch().then(b=>b.close())" 2>/dev/null; then
    export NODE_PATH="$CAND"; break
  fi
done

# Nothing usable: install into the lab, and check the exit status of both commands.
if [ -z "$NODE_PATH" ]; then
  mkdir -p "$LAB"
  ( cd "$LAB" && npm init -y >/dev/null && npm i playwright --no-audit --no-fund ) \
    || { echo "playwright install failed"; exit 2; }
  ( cd "$LAB" && npx playwright install chromium ffmpeg ) \
    || { echo "browser install failed"; exit 2; }
  export NODE_PATH="$LAB/node_modules"
fi

node -e "console.log('playwright', require('playwright/package.json').version)"
```

Keep every `cd` inside a subshell — a bare `cd` would move the session out of the repository and
break the `git` and `gh` commands that follow.

Run headless. The bundled headless shell needs no download on a machine that has ever run
Playwright, and video recording works headless. `--headed` needs the full Chromium build, which is
often absent: if the user wants to watch, print `npx playwright install chromium` and let them
decide, rather than starting a download on their machine unannounced.

## 2. `run.js` — one phase, no verdict

`run.js` ships with the skill, at `scripts/run.js` next to `SKILL.md`. It records; it does not
judge — it knows nothing about "approved". Two rules about it:

* **It is never edited for a run, and never copied into the run directory.** `scenario.js` is the
  per-PR part; `run.js` is the invariant one. One of the two changes, the other does not.
* **Its hash goes into every `phase.json`** as `runnerSha256`, beside the scenario's. Two phases
  judged by different programs cannot be compared, and a verdict stays traceable to the exact code
  that produced it.

Locate it once, before the first phase. Invoke it through `node` and a full path: do not expect the
file to be executable, because an installer may well write it without the execute bit.

```bash
# The copy shipped with this skill, in the directory this skill was read from.
RUNNER="[the directory this skill was read from]/scripts/run.js"
[ -f "$RUNNER" ] || RUNNER=$(find "$HOME/.agents/skills" "$HOME/.claude/skills" .agents/skills .claude/skills \
  -maxdepth 4 -path '*prestashop-pr-qa/scripts/run.js' 2>/dev/null | head -1)
[ -f "$RUNNER" ] || { echo "refusing: scripts/run.js not found — the skill is installed incompletely"; exit 2; }
node -e '' 2>/dev/null || { echo "refusing: node is not on PATH"; exit 2; }
echo "runner $RUNNER sha256 $(shasum -a 256 "$RUNNER" | cut -d' ' -f1)"
```

Then once per phase, from the run directory (`cd "$RUN"`), so every relative path stays inside it:

```bash
node "$RUNNER" --scenario=./scenario.js --phase=before --out=. --url="$FO_URL" --bo-url="$BO_URL"
node "$RUNNER" --scenario=./scenario.js --phase=after  --out=. --url="$FO_URL" --bo-url="$BO_URL"
```

### What a phase leaves behind

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
| `consoleErrors`, `netErrors` | everything the page reported, whether the scenario looked or not |
| `notes` | what the run wants the report to say out loud, flakes included |
| `harness` | faults that void the verdict |

`phase.json` deliberately does not carry the process argv. Credentials reach the runner only
through `QA_BO_EMAIL` / `QA_BO_PASSWORD`, and the report is a file people paste into GitHub.

### What a scenario is handed

`run({ page, context, phase, url, boUrl, step, assert, count, settle, loginBO, note, preflight })`:

| Name | Contract |
|:---|:---|
| `step(name, fn)` | numbers the step, shows it in the video HUD, runs `fn`, settles, screenshots. A throw inside is a harness fault, not a failed PR |
| `assert.ok(name, cond, detail)` | a precondition. It must hold in BOTH phases |
| `assert.bug(name, cond, detail)` | the only thing that can prove the bug. `cond` and `detail` may be async functions — see below |
| `assert.detail(name, cond, d)` | information only. Markup the PR adds belongs here, never in a bug assertion |
| `count(sel, {min, max})` | asserts how many nodes a selector matches, and returns the locator. A selector matching nothing is a harness fault, not a passing "is absent" check |
| `settle()` | waits for the network and the animations. Never `waitForTimeout` |
| `preflight(resp, label)` | records a navigation's status and whether the body is a fatal page. Applied automatically to every document navigation |
| `loginBO()` | logs into the back office with the environment credentials, then asserts that it worked |
| `note(text)` | one line for the report |

### Bug assertions, and what a flake means

Pass `cond` as a function and a failure is re-sampled after settling rather than trusted at once.
**Read the DOM inside that function.** A value captured before the call returns the same reading
twice, so the re-sample proves nothing — that is the one mistake this API invites. `detail` may be
a function too, so the report quotes the reading the verdict actually rests on.

What a flip means depends on the phase, and the runner does not treat the two alike:

| Phase | A flip means | Recorded as |
|:---|:---|:---|
| `before` | the symptom appeared, then cleared: an **intermittent** reproduction | still a reproduction (`passed: false`), plus `flaky` and `intermittent`, plus a note |
| `after` | the fix is in place and the first read was simply too early | the settled reading counts (`passed: true`), plus `flaky`, plus a note |

Neither is a harness fault. A flake is reported, never fatal: voiding a verdict because one page
was slow throws away a run that was valid.

### Exit codes

The exit code says nothing about the PR. `0` means the phase ran cleanly. `2` means the harness
could not produce trustworthy observations — a harness fault, or a failed precondition, which voids
the verdict just the same. Bug assertions failing in the `before` phase is the expected outcome,
not an error, and does not change it. Neither does a flake.

## 3. `scenario.js` — written fresh for each PR

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

## 4. The tokens the diff adds

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
