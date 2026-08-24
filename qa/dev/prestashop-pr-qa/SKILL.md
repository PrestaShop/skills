---
name: prestashop-pr-qa
description: QAs a PrestaShop pull request in a real browser against a shop that is already running, and writes an HTML report stating whether it is approved, with the video and screenshots as proof. Use when the user says "QA this PR", "test this pull request", "check that this fix works", "reproduce this bug", "test this on mobile", "validate PR #123", or asks whether a pull request can be approved. Covers core, modules, themes and libraries, front office and back office, and checks the narrow viewports for layout regressions.
compatibility: Needs a PrestaShop shop already running and reachable over HTTP, an agent with shell access, node and npm (Playwright is installed into a temporary lab on first use), git, curl, and gh authenticated for the repository. Docker is optional — with it the directories the shop serves are detected from the URL, without it the developer is asked for them.
---

# QA a PrestaShop pull request in a real browser

Run the pull request's own test steps against a running shop twice: once on the code as it was
**before** the PR, once on the PR's code. Record both runs. The deliverable is `report.md`, carrying
one verdict — **approved**, **not approved** or **not reproducible** — plus the video and screenshots
that back it up.

## Terms used in this skill

| Term | Meaning |
|:---|:---|
| `before` phase | the measurement taken on the pre-fix code, where the bug must show |
| `after` phase | the measurement taken on the PR's code, where the bug must be gone |
| pre-fix state | the shop running the PR's **merge base** — the code without the fix |
| canary reading | `curl` counting a string the PR introduces, to prove which code the server really serves |
| bug assertion | the one check that can prove the bug. Written in the words of the ticket |
| precondition | something that must hold in both phases. If it fails, the environment is unusable |
| harness error | the measurement itself cannot be trusted. No verdict — and never a failed PR |
| flake | a check that failed, then passed when read again after the page settled |
| regression net | the checks run in both phases that the ticket never asked for: smoke pages, and the narrow viewports |

## Rules that do not bend

1. **The developer owns `git`. This skill never checks anything out.** A checkout can destroy
   uncommitted work, and it is the developer's branch. Print the command, ask, wait.
2. **Everything derived from the code, the skill offers to run itself**: `composer install`, the
   build, `cache:clear`. The order matters — rebuild first, read the canary second.
3. **`before` runs first, always.** Migrations, module upgrade scripts and new configuration keys
   only run forward. Testing the PR first leaves the `before` run reading a migrated database.
4. **The same `scenario.js` runs in both phases, unchanged**, and so does `scripts/run.js`. Both
   hashes are recorded in each phase; a mismatch voids the verdict.
5. **Nothing is ever posted to GitHub.** The comment is written to a file for the user to paste.
6. **Back-office credentials arrive as the `QA_BO_EMAIL` and `QA_BO_PASSWORD` environment
   variables**, never as command-line arguments: arguments end up in artifacts that get pasted into
   a public pull request.
7. **The scenario asserts; it never decides.** The verdict comes from the table in this file.
8. **Evidence never lands in the shop or in the checkout.** `scripts/pick-run-dir.sh` enforces this.

## What to ask the user

* the pull request: `owner/repo#number`, or its URL
* the front-office URL of the running shop
* the back-office URL and the admin folder name, if the PR touches the back office — that folder
  name differs on every installation
* whether the shop can be put in its pre-fix state. Without it there is no `before` phase, and the
  verdict is capped at "approved — reproduction not attempted"

Do not ask for paths on disk: `scripts/pick-run-dir.sh` derives them from the URL. Ask only if it
refuses because the shop does not run in Docker.

## Workflow

A typical request: *QA the PR PrestaShop/hummingbird#1092 against http://localhost:8887*. What
follows is the whole run, from reading that PR to handing over a comment to paste.

Copy this checklist into your reply and tick items off as you go:

```
QA progress:
- [ ] 1. Read the PR and its linked issues
- [ ] 2. Set up the run directory and Playwright
- [ ] 3. Write scenario.js from the ticket's steps
- [ ] 4. GATE: show the scenario, ask for the pre-fix state
- [ ] 5. Measure the before phase
- [ ] 6. GATE: ask for the PR's code
- [ ] 7. Measure the after phase
- [ ] 8. Write verdict.json, render report.html, write report.md and comments/
```

### 1. Read the PR and its linked issues

```bash
gh pr view [number] --repo [owner/repo] \
  --json title,body,baseRefName,headRefOid,files,closingIssuesReferences,labels
```

Read every linked issue with `gh issue view`. Then:

* Classify the PR as **bugfix** or **new feature**.
* Find the test steps. They sit in a table row of the PR body whose label is not standardised —
  `How to test?`, `How to test`, sometimes missing. Reproduction steps and the affected version are
  usually in the linked issue, not the PR. If they exist in neither, derive them from the diff and
  **say in the report that they were inferred**.
* **Stop here** if the diff changes nothing a browser can observe — CI config, documentation, tests
  only, a pure refactor. Say which it is, and that there is no browser verdict to give. Inventing
  steps for such a PR manufactures a verdict out of nothing.
* Check whether the PR silently depends on another PR before blaming the code. The probe is in
  [references/prestashop.md](references/prestashop.md).

### 2. Set up the run directory and Playwright

`SKILL_DIR` is the directory this file was read from. Both scripts print their reasoning to stderr
and their one result to stdout.

```bash
RUN=$(sh "$SKILL_DIR/scripts/pick-run-dir.sh" "[front-office URL]" \
        "$HOME/prestashop-pr-qa/[owner]-[repo]-pr-[number]")
NODE_PATH=$(sh "$SKILL_DIR/scripts/playwright-lab.sh"); export NODE_PATH
```

If `pick-run-dir.sh` exits non-zero, stop and read what it printed — it refuses when the evidence
would land somewhere it could be committed or served over HTTP. When the shop does not run in
Docker it asks for the served directory; pass it as a third argument.

Tell the user the run directory now, and again at the end, so the files are findable when the
comment gets pasted. It holds:

| Path | What it is |
|:---|:---|
| `report.html` | **what the developer opens**: the verdict, the paired screenshots, the video, the comment to paste |
| `verdict.json` | the judgement, machine-readable. The one place a verdict is written; both reports render it |
| `report.md` | the same run in text, for grepping and for tickets that do not render HTML |
| `scenario.js` | the script that was run, kept so anyone can repeat the run |
| `before/`, `after/` | `video.webm`, one `NN-slug.png` per step, and `phase.json` |
| `comments/` | one file per GitHub target, holding **only** what to paste there |
| `env/` | PR metadata, the tokens the diff adds, the canary readings, the guarded paths |

The run directory is **reused** across passes on the same PR; a phase directory is not. The runner
empties `before/` or `after/` itself before measuring it, so an earlier pass's video can never be
read as this run's proof — nothing to remember, and nothing to forget. Move a pass aside first
(`mv before before-01`) if it is worth keeping. Whatever you do find in a phase directory is only
evidence if its `phase.json` hashes match the `scenario.js` and `scripts/run.js` about to run;
otherwise treat that phase as absent and say so.

### 3. Write scenario.js from the ticket's steps

Write it from the **ticket's** steps first. Read the diff only afterwards, and only to find which
page to open and whether a build is needed. One `step()` per test step. The template, the assertion
kinds and the runner's API are in [references/runner.md](references/runner.md).

Call `clip()` once, in the step where the symptom is visible, naming a container that exists in
both phases. The report leads with that clipped pair, which is what makes it readable — see
[references/runner.md](references/runner.md).

If the ticket is about mobile, declare `viewport: 'mobile'` in the scenario, so the bug is measured
at the width where it was reported — see [references/runner.md](references/runner.md).

Then check every bug assertion against the tokens the diff adds — the recipe is in
[references/runner.md](references/runner.md). A bug assertion naming a class, id or attribute the PR
introduces proves nothing: in the pre-fix state that selector is simply absent, the check fails, and
the run claims a reproduction it never made. Rewrite it in the words of the ticket.

### 4. GATE — show the scenario, ask for the pre-fix state

Show the scenario. Then print the exact commands for the pre-fix state, with the reason for each:

| Command | Why |
|:---|:---|
| `git checkout [merge base]` | the merge base is the true pre-fix state; the base branch tip carries other people's merges |
| `composer install --no-dev` | mandatory for a module: its `vendor/` is not in git |
| the theme or asset build | only if the diff touches compiled sources |
| `cache:clear` | needed for PHP, Twig and YAML changes |

Offer to run the last three yourself, so the rebuild happens before the canary reading. Leave `git`
to the developer. Then **wait**.

Skip the `before` phase, saying why, when the diff touches something a code downgrade cannot
undo: `install/upgrade/sql/`, `upgrade/upgrade-*.php`, `ALTER TABLE`, `ADD COLUMN`, or hook
registration inside `install()`. For a new feature there is nothing to reproduce: go to step 6.

Name any fixture data or configuration change out loud before creating it, and list it in the
report.

### 5. Measure the before phase

```bash
curl -s -L '[url]' | grep -c '[string the PR introduces]'   # the canary reading
( cd "$RUN" && node "$SKILL_DIR/scripts/run.js" \
    --scenario=./scenario.js --phase=before --out=. --url="[FO URL]" --bo-url="[BO URL]" )
```

The `cd` stays inside a subshell: a bare `cd` moves the session out of the repository and breaks the
`git` and `gh` commands in the steps that follow.

`curl` has no cache, no service worker and no profile, so it reports what the server actually
serves. A back-office change has to be read in the browser instead — see
[references/prestashop.md](references/prestashop.md).

### 6. GATE — ask for the PR's code

Print the commands, wait, then take the second canary reading.

### 7. Measure the after phase

Same as step 5 with `--phase=after` (the runner clears the directory itself), then compare the two canary readings. **Identical readings mean
the shop never changed state** — a stale Symfony or Smarty cache, an untouched opcache, or a URL
served from a different directory than the one that was switched. That is a harness error: say so
and stop, with no verdict.

### 8. Write the verdict, then the reports

Apply the verdict table below, and write the judgement **once**, into `verdict.json`:

```json
{
  "verdict": "approved | not-approved | not-reproducible | not-applicable",
  "caveat": "the one sentence that qualifies the verdict, or omit",
  "why": "one sentence of reasoning",
  "pr": { "repo": "owner/repo", "number": 1234, "title": "…" },
  "classification": "bugfix | feature",
  "stepsFrom": "where the test steps came from, in words",
  "shop": { "fo": "…", "bo": "…", "versions": "PrestaShop x, PHP y, theme z" },
  "states": { "before": "merge base <sha>", "after": "PR head <sha>" },
  "canary": { "before": 0, "after": 1 },
  "notTested": ["…"],
  "comment": "the exact text to paste on GitHub"
}
```

Then render the page — it reads `verdict.json` and both `phase.json`, and invents nothing:

```bash
node "$SKILL_DIR/scripts/report.js" --run="$RUN"
```

Write `report.md` too, in the layout below: same facts, as text. Then write `comments/`, tell the
user the `pbcopy` command for each target, where `report.html` is, and which state the shop was left
in with the command that restores it.

## Verdict

| Kind | `before` | `after` | Verdict |
|:---|:---|:---|:---|
| bugfix | reproduced | all pass | 🟢 approved |
| bugfix | reproduced | a bug assertion fails | 🔴 not approved — the fix does not fix it |
| bugfix | did not reproduce | any | 🟡 not reproducible — neither approval nor rejection; ask the reporter for the version and the steps |
| bugfix | not attempted | all pass | 🟢 approved — reproduction not attempted (the caveat goes on line 1, not in a footnote) |
| bugfix | not attempted | a bug assertion fails | 🔴 not approved — the documented steps do not produce the documented result |
| feature | n/a | all pass | 🟢 approved |
| feature | n/a | any fails | 🔴 not approved |
| any | n/a | n/a | ⚫ not applicable — the diff changes nothing a browser can observe |

A check that fails in **both** phases is pre-existing: report it, do not hold it against the PR.

### The regression net

Every phase also runs checks the ticket never asked for: the smoke pages, and the front page plus up
to two of the pages the scenario opened, re-visited at **375 and 768 wide**. The narrow pass asks
only whether the shop still works at that width — the page responds, it renders visible content, it
does not scroll sideways. It never judges the design.

Everything is measured in both phases, which is the whole point: the comparison is what makes a
finding attributable.

| Finding | In `before` | In `after` | How to report it |
|:---|:---|:---|:---|
| a narrow page with `ok: false`, or a smoke page that fails | no | yes | 🔴 **introduced by this PR.** Name the page, the width, which of `responds` / `rendered` / `overflowPx` failed, and the boxes `phase.json` lists. Set the verdict to not approved even when every bug assertion passed |
| the same finding | yes | yes | 🟡 pre-existing. Report it, do not hold it against the PR |
| the same finding | yes | no | 🟢 the PR fixed it as well. Say so in one line |

Nothing else about the narrow layouts is asserted, on purpose: a cramped price, a button on two
lines, a stretched image are for a human to judge. The `mobile-*.png` and `tablet-*.png` pairs sit
in the run directory for exactly that, and the report points at them instead of pretending to judge
them.

A **flake** means two different things depending on the phase:

* in `before`, the symptom appeared and then cleared. It was still observed, so the row stays
  **reproduced**, with the word *intermittent* on line 1 of the verdict. An intermittent bug is a
  real bug, and the reporter needs to know it was not seen every time.
* in `after`, the settled reading is the one that counts. The phase passes, and the report says the
  first reading was taken too early.

Neither voids the verdict. `phase.json` marks both as `flaky: true`, and the `before` case as
`intermittent`.

**Refuse to give any verdict at all** — a harness error, never a PR failure — when:

* `scenarioSha256` differs between the two phases
* `runnerSha256` differs between them (two different programs judged them; they are not comparable)
* the two canary readings are identical
* a precondition failed
* a selector matched nothing
* a bug assertion names markup the PR introduces

### Severity markers

| Marker | Severity | Meaning |
|:---|:---|:---|
| 🔴 | Blocker | Introduced by this PR. Not approved |
| 🟡 | Warning | Pre-existing, or outside what was covered. Noted, does not block |
| 🟢 | OK | Asserted and observed in the browser |

## The two reports

`report.html` is the deliverable the developer reads: one page, the verdict first, the paired
screenshots and the video as evidence, the comment ready to copy. `scripts/report.js` renders it
from `verdict.json` and the two `phase.json` — never by hand, so every run looks the same and the
page cannot claim more than was measured. Its visual language is documented in
[references/design.md](references/design.md).

`report.md` is the same run written out as text: it greps, it diffs, and it survives being pasted
into a tool that does not render HTML.

## report.md layout

In this order:

1. the verdict as the H1, with any caveat immediately under it
2. the environment: URLs, PrestaShop and PHP versions, the two states tested, the commands run in
   each phase and who ran them, the Playwright and Chromium versions, the runner path and its
   `runnerSha256`, and the state the shop was left in
3. the classification, and **where the test steps came from**
4. reproduction, then verification
5. the regression net: the smoke pages and the two narrow viewports, each stated as introduced,
   pre-existing or fixed, ending with the sentence `Regression coverage: smoke pages, plus 375/768 responds-renders-no-overflow only.`
6. the honesty checks: both hashes identical across phases, preconditions, canary readings, bug
   assertions referencing PR-introduced markup, flake re-samples
7. what was not tested
8. the verdict and one sentence of reasoning
9. a pointer to `comments/`, and the artifact tree

Reference screenshots paired by step index, so a reviewer sees both states of the same moment:

| # | Step | before | after |
|:--|:---|:---|:---|
| 03 | observe the symptom | `before/03-observe-the-symptom.png` | `after/03-observe-the-symptom.png` |
| — | front page at 375 | `before/mobile-home.png` | `after/mobile-home.png` |
| — | front page at 768 | `before/tablet-home.png` | `after/tablet-home.png` |

Write it flat: no emoji outside the severity markers, no first person, no hedging, no praise, no
restating the diff.

## What to post on GitHub

`report.md` is for the person who ran the QA, not for GitHub: it is too long, it carries local
paths, and a fenced block inside it has to be hand-selected before it can be pasted. Write the
GitHub text as its own files, one per target, named `[owner]-[repo]-[number].md`:

```text
comments/
├── index.md                          # what to post where, and in what order
└── PrestaShop-hummingbird-1092.md    # paste this, whole, into that PR
```

Rules for a file in `comments/`:

* **Its entire content is the comment.** No surrounding fence, no report headings, nothing to trim:
  `pbcopy < comments/[file].md` then paste. Tell the user that command.
* First line is the verdict. Second line is this disclaimer, verbatim:
  `Note: AI-generated QA review. The tooling is still being tested — please sanity-check the verdict.`
* No absolute paths, no run-directory paths, no credentials — the reader cannot see your disk.
* Name the files to attach by hand: images and video cannot be uploaded programmatically.
* At most about 15 lines before the attachment line. The detail stays in `report.md`.
* `index.md` lists each file with its target URL and one line on why it is being posted. One line
  long for a single target, which is fine — it is how the user knows they are done.

Write a second file **only** when the verdict genuinely covers another repository — a theme PR that
needed a core PR applied alongside it, say. Then each comment is written for its own readers, and
both state that the result covers the combination rather than either PR alone.

## Troubleshooting

| What you see | Cause | What to do |
|:---|:---|:---|
| `refusing: nothing publishes port N` | the shop is not in Docker, so nothing declares what it serves | ask which directory the web server serves, pass it as a third argument to `pick-run-dir.sh` |
| `refusing: <dir> is inside <dir>` | the run directory would be committed into the PR or served over HTTP | pick a run directory outside the shop and outside the checkout, e.g. under `$HOME` |
| `node is not on PATH` | node is installed through nvm or asdf, which a non-interactive shell does not load | ask the user to run the QA from a shell where `node -v` works |
| the two canary readings are identical | the code never changed: a stale Symfony or Smarty cache, an untouched opcache, or a URL served from another directory | offer to run `cache:clear` and the build, then read the canary again. If it still matches, stop — there is no verdict |
| a precondition failed in one phase | the environment differs between the two phases, so the two runs are not comparable | fix the environment and rerun that phase. Never report a verdict from it |
| `selector matched 0, expected 1..` | the scenario names markup that is absent in that phase | rewrite the check in the words of the ticket, using a selector that exists in both phases |
| a page overflows sideways in **both** phases | pre-existing responsive defect, not this PR | report it as 🟡 with the width and the page, and move on |
| the bug fails in **both** phases | pre-existing, not caused by this PR | report it as 🟡 and do not hold it against the PR |
| a module change is invisible in the shop | a module has to be reset in the Module Manager for its new code to apply | reset the module, then read the canary again — see [references/prestashop.md](references/prestashop.md) |
| `scripts/run.js not found` | the skill was installed incompletely | reinstall the skill; the runner ships with it and is never written by hand |

## Bundled files

| File | What is in it |
|:---|:---|
| [references/runner.md](references/runner.md) | the runner's API, the scenario template, the diff-token recipe, and the checks that pass for the wrong reason |
| [references/prestashop.md](references/prestashop.md) | back-office login and tokens, caches, builds, module `vendor/`, one-way migrations, the PR-dependency probe |
| `scripts/run.js` | runs one phase and records what happened. Executed, never edited for a run |
| `scripts/report.js` | renders `report.html` from `verdict.json` and the two `phase.json`. Presents; never decides |
| [references/design.md](references/design.md) | the colours, type, spacing and layout rules `report.js` inlines, and the three places a QA report has to depart from them |
| `scripts/pick-run-dir.sh` | picks the run directory, refuses one that would leak the evidence |
| `scripts/playwright-lab.sh` | finds or installs a working Playwright outside the shop |
