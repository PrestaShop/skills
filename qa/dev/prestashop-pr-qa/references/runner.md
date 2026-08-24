# The runners and the scenario

## Contents

* Three probes, one set of rules
* Running a phase in a browser
* What a browser scenario is handed
* Viewports and the responsive net
* Marking the region that matters
* The command-line probe
* The HTTP probe
* What a phase leaves behind
* Bug assertions, and what a flake means
* Exit codes
* `scenario.js`, written fresh for each PR
* The tokens the diff adds
* Checks that pass for the wrong reason
## Three probes, one set of rules

| File | What it does |
| --- | --- |
| `scripts/record.js` | the half of a phase no probe changes: preconditions, bug assertions, the flake rule, `phase.json`, the exit code |
| `scripts/run.js` | observes in Chromium, driven by Playwright. Screenshots, video, the narrow pass |
| `scripts/run-cli.js` | observes by running commands. Transcripts, exit codes, files touched |
| `scripts/run-http.js` | observes by making requests. Status, headers, body |
| `scenario.js` | written into the run directory, rewritten for every PR |

The rules live in `record.js` on purpose. A CLI verdict and a browser verdict are reached the same way, and three copies of the honesty rules would drift within a month.

Every runner records; none of them judges. None knows the word "approved". Three hashes go into each `phase.json`, `scenarioSha256`, `runnerSha256` and `recordSha256`, and if any of them differs between the two phases they were not the same experiment, so there is no verdict.

Those three cover the **instruments**, never the observations. Screenshots, transcripts and videos are not hashed, and they do not need to be: they are what the instruments produced, and an instrument that changed between the phases has already voided the verdict before anyone looks at them. The two files that carry a decision are `scenario.js`, which chooses what to measure, and `verdict.json`, which says what the measurements mean. Everything else in a run directory is produced from those.
## Running a phase in a browser

Playwright is the only dependency, and it is the one that matters: it is the library the runner drives, and installing it also brings the Chromium build the pages are observed in and the ffmpeg build that records the video. `scripts/playwright-lab.sh` reuses one already on the machine or installs one into a throwaway lab under `$TMPDIR`, never into the environment under test or the repository, where a `node_modules/` would end up in a pull request.

```bash
NODE_PATH=$(sh "$SKILL_DIR/scripts/playwright-lab.sh"); export NODE_PATH

cd "$RUN"   # every relative path below then stays inside the run directory
node "$SKILL_DIR/scripts/run.js" --scenario=./scenario.js --phase=before --out=. \
  --url="$FO_URL" --bo-url="$BO_URL"
```

Three things worth knowing about that command:

* `--out=.` is the run directory. The runner appends the phase name itself, so `--phase=before` writes into `before/`. Passing `--out=./before` would nest it twice. It **empties** that phase directory before measuring, so a screenshot from an earlier pass is never cited as this run's.
* Invoke it with `node` and a path, never as an executable: an installer may write the file without the execute bit.
* Run headless. Video recording works headless, and `--headed` needs the full Chromium build, which is often absent. If the user wants to watch, print `npx playwright install chromium` and let them decide rather than starting a download on their machine unannounced.

Keep every `cd` inside a subshell when you are not in the run directory for good: a bare `cd` moves the session out of the repository and breaks the `git` and `gh` commands that follow.
## What a browser scenario is handed

`run({ page, context, phase, url, boUrl, step, assert, count, settle, loginBO, note, preflight, clip })`:

| Name | Contract |
| --- | --- |
| `step(name, fn)` | numbers the step, shows it in the video HUD, runs `fn`, settles, screenshots. A throw inside is a harness error, not a failed PR |
| `assert.ok(name, cond, detail)` | a precondition. It must hold in BOTH phases |
| `assert.bug(name, cond, detail)` | the only thing that can prove the bug. `cond` and `detail` may be async functions, as described below |
| `assert.detail(name, cond, d)` | information only. Markup the PR adds belongs here, never in a bug assertion |
| `count(sel, {min, max})` | asserts how many nodes a selector matches, and returns the locator. A selector matching nothing is a harness error, not a passing "is absent" check |
| `settle()` | waits for the network and the animations. Never `waitForTimeout` |
| `preflight(resp, label)` | records a navigation's status and whether the body is a fatal page. Applied automatically to every document navigation |
| `loginBO()` | logs into the back office with the environment credentials, then asserts that it worked |
| `note(text)` | one line for the report |
| `clip(selector, label)` | clips a screenshot of that region, at full size, so the report can lead with the part that changed instead of two full pages. Call it once, in the step where the symptom is visible |
## Viewports and the responsive net

A scenario runs at 1280×900 by default. When the ticket is about mobile (*"on my phone the menu does not close"*), declare it, so the bug is measured where it was reported:

```js
module.exports = { name: '...', kind: 'bugfix', where: 'fo', viewport: 'mobile', /* ... */ };
```

`viewport` accepts `desktop` (1280×900), `mobile` (375×812) or `tablet` (768×1024). It changes where the **bug assertion** is measured, nothing else.

Independently of that, every phase ends with a **responsive net**: the front page plus up to two of the pages the scenario actually opened, re-visited at 375 and 768 wide. Two widths, always the same, never derived from the PR. That is what makes the two phases comparable.

The question it answers is *does the shop still work narrow*, not *is the design good*. Three binary facts per page and width, and nothing else:

| Field | True when |
| --- | --- |
| `responds` | the page returned under 400 and is not a fatal error page |
| `rendered` | `body` is really being rendered and shows more than 20 characters of visible text. Catches a layout hidden at one width, a real mistake and invisible on desktop |
| `overflowPx` | 0. Above 0, the page scrolls sideways at that width |

`ok` is all three at once. Each is mechanical, so the net never produces a finding a human has to dismiss. `worst` names up to three visible boxes that stick out, as a hint. `position: fixed` elements are skipped, because a fixed element cannot make the document scroll, so an off-canvas menu parked to the right of the viewport is not the culprit.

A screenshot is taken at each width whether or not anything failed: everything a machine cannot judge, such as a cramped price, a two-line button or an image out of proportion, is judged by the reviewer looking at `mobile-*.png` and `tablet-*.png` side by side across the two phases.
## Marking the region that matters

A full-page screenshot proves the run happened; it rarely shows the reader what changed. `clip()` takes one region and the report puts that pair first, with the whole page folded away behind it.

```js
await clip('<the container the symptom lives in, present in both phases>',
           '<what that region is, in the words of the ticket>');
```

Two rules, both the same as for a bug assertion:

* **The selector must exist in both phases.** Name the container the symptom lives in, never the markup the PR adds. A region that only resolves in `after` gives a pair with nothing to compare. When the PR makes an element appear, mark its parent, which exists either way.
* **A miss is a note, not a harness error.** A missing screenshot is a worse reason to void a verdict than the missing screenshot itself.

The screenshot is the element plus 24px, so the region can be placed on the page at a glance. It lands in `phase.json` under `clips`. Call it once per run: the report leads with the first pair, and a page of clips is a contact sheet, not an argument.
## The command-line probe

```bash
node "$SKILL_DIR/scripts/run-cli.js" --scenario=./scenario.js --phase=before --out=. --cwd=<checkout>
```

No dependency: Node's own `child_process` is enough, so a CLI QA needs neither Playwright nor npm. A scenario is handed `{ phase, cwd, step, assert, note, sh, file, settle }`:

| Name | Contract |
| --- | --- |
| `sh(command, { cwd, env, timeoutMs })` | runs it through `/bin/sh -c` and records it, command line included. Returns `{ code, stdout, stderr, ms, out }`. A non-zero exit is data, never a crash: half the bugs worth QA-ing on a command line ARE the exit code, so the scenario decides what it means. **Never put a secret in the command**, it ends up in `phase.json` and in the transcript; pass it in `env` |
| `file(path)` | `{ exists, bytes, sha256 }` for a path relative to `--cwd`. Size and hash, never the content, because a dump can be enormous and can carry credentials |
| everything else | identical to the browser probe |

A command that prints `Done.` and changes nothing has done nothing, so **measure the side effect as well as the output**. `file()` before and after in the same phase is how you prove a file was really written, and comparing the two phases is how you prove the PR is what changed it.

The scenario may declare `smoke: ['<a command that must keep working>']`. There is no universal floor on a command line, so if it declares none the runner says so in a note rather than pretending to have checked.

The evidence is `transcript.txt` per phase, with every command, its output and its exit code, and the report pairs them the way it pairs screenshots.
## The HTTP probe

```bash
node "$SKILL_DIR/scripts/run-http.js" --scenario=./scenario.js --phase=before --out=. --url=<base>
```

For what the server answers rather than what a page shows. A scenario is handed `{ phase, url, step, assert, note, req, get, settle }`:

| Name | Contract |
| --- | --- |
| `req(method, target, { headers, body, auth })` | one request, recorded. Returns `{ status, headers, contentType, location, body, text, json, ms }` |
| `get(target, opts)` | the same, for the common case |
| `auth: 'ws'` | Basic auth from `QA_WS_KEY` in the environment. The header is **redacted** in `phase.json` and in the transcript, both of which end up attached to a public pull request |

**Redirects are not followed.** For this kind of PR the redirect often IS the subject, and following it would hide the status code under test. `location` carries where it pointed.

The scenario may declare `smoke: ['<an endpoint that must keep answering>']`, same rule as the CLI probe.
## What a phase leaves behind

`video.webm`, one `NN-slug.png` per step taken after the page settled, and `phase.json`:

| Field | What it is |
| --- | --- |
| `phase`, `url`, `boUrl`, `viewport`, `playwright`, `startedAt`, `finishedAt` | the conditions of the measurement |
| `scenarioSha256`, `runner`, `runnerSha256`, `recordSha256` | what ran, which program judged it, and under which recording rules. The report compares all three hashes across the phases |
| `preconditions` | `assert.ok` results. One failure and the phase is unusable |
| `bugs` | `assert.bug` results. `passed: true` means CORRECT behaviour was observed |
| `details` | `assert.detail` results. Information, never proof |
| `steps` | one row per `step()`: number, name, screenshot, duration, and how many console or network problems appeared during it |
| `smoke` | the fixed regression net: front page, a product page, the cart, the back office |
| `clips` | one row per marked region: its label, its selector and the clipped screenshot |
| `responsive` | one row per page per narrow viewport: `responds`, `rendered`, `overflowPx`, the boxes that stick out, and a screenshot |
| `consoleErrors`, `netErrors` | everything the page reported, whether the scenario looked or not |
| `notes` | what the run wants the report to say out loud, flakes included |
| `harness` | faults that void the verdict |

`phase.json` never records the arguments the runner itself was started with, so the URLs and flags you typed do not travel with the report. Credentials do not reach it either: the back office reads `QA_BO_EMAIL` and `QA_BO_PASSWORD` from the environment, and the HTTP probe replaces its `Authorization` header with `[redacted]` before writing anything.

The command-line probe is the exception worth knowing. It records **every command it runs and everything they print**, in `phase.json` and in `transcript.txt`, because on a command line that IS the measurement and a report that hides it proves nothing. Two rules follow, and the runner cannot enforce either one for you.

Never type a secret into a command. Pass it in `env`, which the runner hands to the command and never writes down. And never run a command that prints one: a verbose `curl`, a configuration dump, an environment listing. What such a command prints lands in the transcript, and the transcript gets attached to a public pull request.
## Bug assertions, and what a flake means

`assert.bug` is the only assertion that re-samples, so it is the only one that takes a function. Hand it one and a failure is settled and read again rather than trusted at once. **Read the DOM inside that function.** A value captured before the call returns the same reading twice, so the re-sample proves nothing. That is the one mistake this API invites. `detail` may be a function too, so the report quotes the reading the verdict actually rests on.

Handing a function to `assert.ok` or `assert.detail` is refused, loudly. A function is always truthy, so it would have recorded a satisfied precondition for a condition nobody ever evaluated. Call it yourself and pass the result.

What a flip means depends on the phase, and the runner does not treat the two alike:

| Phase | A flip means | Recorded as |
| --- | --- | --- |
| `before` | the symptom appeared, then cleared: an **intermittent** reproduction | still a reproduction (`passed: false`), plus `flaky` and `intermittent`, plus a note |
| `after` | the fix is in place and the first read was simply too early | the settled reading counts (`passed: true`), plus `flaky`, plus a note |

Neither is a harness error. A flake is reported, never fatal: voiding a verdict because one page was slow throws away a run that was valid.
## Exit codes

`--phase` accepts only `before` or `after`, and both it and `--url` are required: a typo exits 2 before the browser starts rather than producing a run whose phase is neither.

The exit code says nothing about the PR. `0` means the phase ran cleanly. `2` means the harness could not produce trustworthy observations: a harness error, or a failed precondition, which voids the verdict just the same. Bug assertions failing in the `before` phase is the expected outcome, not an error, and does not change it. Neither does a flake.
## `scenario.js`, written fresh for each PR

The SAME file runs in both phases, unchanged. Its hash goes into each `phase.json` and a mismatch voids the verdict. One scenario, one probe: the file is written against the probe that will run it.

### Four rules, whatever the probe

1. **`assert.bug()` is the only thing that can prove the bug.** Write it in the reporter's words. Never name a class, id, attribute, file or flag the PR ADDS: before the fix it is absent, the check fails, and you would report a reproduction you never made.
2. **`assert.ok()` is a precondition.** It must hold in BOTH phases. If one fails the environment is unusable and there is no verdict, which is not the same as a failed PR.
3. **Never branch on `phase` for an assertion.** Branch on it only to create data the older code cannot create on its own, and say so with `note()`.
4. **Read inside the `assert.bug` callback, never into a variable before the call.** The callback is re-sampled when it fails, and a captured value hands it the same reading twice. `assert.ok` and `assert.detail` do not re-sample and refuse a function outright.

### The fields a scenario declares

| Field |  |
| --- | --- |
| `name` | one line, what the ticket says is wrong |
| `bug` | the user-visible symptom, in the reporter's words |
| `kind` | `bugfix` or `feature` |
| `where` | `fo`, `bo` or `both` in a browser; `cli`; `http` |
| `viewport` | browser only. `desktop` by default, `mobile` when the ticket is about mobile |
| `smoke` | command line and HTTP only. What must keep working. Declare none and the runner says so in a note rather than pretending to have checked |
| `pr`, `issue` | read by nothing. They keep the file self-describing once it is attached to the report |

### A browser scenario

Every selector you depend on goes through `count()`, which turns a silent zero-match into a harness fault. Two exceptions. Markup the PR ADDS is read with `page.locator(...).count()` directly, because `count()` with `min: 1` would record a harness fault in `before` and void the verdict for the wrong reason. And inside an `assert.bug` callback a missing element already throws, which lands in harness on its own. No `waitForTimeout`: use `settle()`.

```js
module.exports = {
  name: 'what the ticket says is wrong, one line',
  pr: 'owner/repo#0000',
  issue: 'owner/repo#0000 or null',
  kind: 'bugfix',          // 'bugfix' | 'feature'
  where: 'fo',             // 'fo' | 'bo' | 'both'
  bug: 'the user-visible symptom, in the reporter\'s words',

  // `url` is the front office, `boUrl` the back office. Navigate with the one that matches
  // `where`, or a back-office scenario logs in and then measures the shop.
  async run({ page, phase, url, boUrl, step, assert, count, settle, loginBO, note, preflight, clip }) {
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
      // Mark the region the report will lead with, before reading it.
      await clip('<the container the symptom lives in>', '<what that region is>');
      // Rule 4: read inside the callbacks, never before them.
      const read = async () => (await page.locator('<selector present in both phases>').first().innerText()).trim();
      await assert.bug(
        '<the symptom, in the words of the ticket>',
        async () => (await read()) === '<what a correct shop shows>',
        async () => `observed "${await read()}"`,
      );
      // Markup the PR adds: page.locator, not count(). Information only, never proof.
      assert.detail('<markup the PR introduces>',
        (await page.locator('<the new selector>').count()) === 1);
    });
  },
};
```

### A command-line scenario

A non-zero exit is data, so the scenario says what it means. Measure the side effect as well as the output: a command that prints `Done.` and changes nothing has done nothing.

```js
module.exports = {
  name: 'what the ticket says is wrong, one line',
  kind: 'bugfix',
  where: 'cli',
  bug: 'the symptom as the person running the command sees it',
  smoke: ['<a command that must keep working>'],

  async run({ phase, cwd, step, assert, note, sh, file, settle }) {
    await step('the command from the ticket', async () => {
      const before = await file('<the path the command should write>');
      const r = await sh('<the command from the ticket>');
      assert.ok('the command exists', r.code !== 127, String(r.code));

      // Rule 4: re-read inside the callback, never reuse `r`.
      await assert.bug(
        '<the symptom, in the words of the ticket>',
        async () => (await sh('<the command from the ticket>')).code === 0,
        async () => `exit ${r.code}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`,
      );

      const after = await file('<the path the command should write>');
      assert.detail('the file it should write changed',
        before.sha256 !== after.sha256, `${before.bytes} -> ${after.bytes} bytes`);
    });
  },
};
```

### An HTTP scenario

Redirects are not followed, so `location` carries where the response pointed. The status code is usually the subject.

```js
module.exports = {
  name: 'what the ticket says is wrong, one line',
  kind: 'bugfix',
  where: 'http',
  bug: 'what the caller receives instead of what it should',
  smoke: ['<an endpoint that must keep answering>'],

  async run({ phase, url, step, assert, note, req, get, settle }) {
    await step('the request from the ticket', async () => {
      const r = await get('<the path from the ticket>');
      assert.ok('the server answered at all', r.status > 0, String(r.status));

      // Rule 4: re-request inside the callback, never reuse `r`.
      await assert.bug(
        '<the symptom, in the words of the ticket>',
        async () => (await get('<the path from the ticket>')).status === 200,
        async () => `status ${r.status}${r.location ? `, pointing at ${r.location}` : ''}`,
      );
      assert.detail('what it answered with', true, r.contentType || 'no content type');
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
# Then keep only code-shaped names (snake_case, kebab-case, camelCase, PascalCase) because
# plain English words the diff happens to add would otherwise flood the comparison.
comm -23 env/added env/removed | grep -E '_|-|[a-z][A-Z]|^[A-Z]' > env/diff-added-tokens.txt
```

Then check the scenario against it, looking only inside the bug assertions:

```bash
awk '/assert\.bug\(/,/\);/' scenario.js \
  | grep -oE '[A-Za-z_][A-Za-z0-9_-]{3,}' | sort -u \
  | comm -12 - env/diff-added-tokens.txt
```

Any name printed has to be rewritten in user-visible terms before the run. Hits inside `assert.detail` do not matter. That is what `detail` is for, which is why the check is scoped to `assert.bug` blocks.

The grep is an aid, not the rule. A single lowercase word the PR introduces, say a new class called `hidden`, slips through it, and the rule still stands: a bug assertion says what the person who filed the ticket would see.
## Checks that pass for the wrong reason

These are the ways a browser check reports success while proving nothing. Every one has been paid for at least once.

Four of them the runner now guarantees, so they are listed only so you know they are handled and do not need guarding again: a document navigation returning 400 or worse, or landing on a fatal page, is recorded as a failed precondition whether or not the scenario calls `preflight`; screenshots are taken after `settle()`; and the video is saved by name rather than by picking the newest file in the directory.

The rest are yours. Nothing in the runner can prevent them, because they are choices made while writing assertions:

- **A selector matching nothing makes every "is absent" check pass.** `count()` reports it, but only for selectors you actually pass through `count()`. A bare `page.locator()` is unguarded.
- **A diff-derived selector fakes a reproduction.** Before the fix, markup the PR adds is missing; the check fails and looks exactly like the bug. Only user-visible symptoms prove a bug.
- **`element.focus()` proves nothing** about keyboard access. Walk `Tab` from the top and see where focus actually lands.
- **A focus ring read too early is not there yet.** Let transitions finish before measuring outline or box-shadow. `step()` settles at its end, which does not help you mid-step.
- **`event.defaultPrevented` does not prove handling** on a native control: the browser may have acted anyway.
- **An attribute without a visible effect is not a feature.** Assert the attribute *and* what the user sees. The attribute alone belongs in `assert.detail`.
- **Panel height is not visibility.** A drawer hidden by `transform` keeps its full height.
- **An element's own `display` says nothing about a hidden ancestor.** Ask the browser whether it is really visible.
- **Icon-font glyphs live in the Unicode private use area** and are not visible text: they will never match a text assertion.
- **Built assets and `vendor/` do not follow a git checkout.** For themes this is the norm rather than an edge case. See `prestashop.md`, "A theme's built assets do not follow a git checkout".

