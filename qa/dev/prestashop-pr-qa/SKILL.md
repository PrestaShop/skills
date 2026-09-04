---
name: prestashop-pr-qa
description: QAs a PrestaShop pull request against an environment that is already running, in a real browser, on the command line or over HTTP, and writes an HTML report stating whether it is approved, with the recording as proof. Use when the user says "QA this PR", "test this pull request", "check that this fix works", "reproduce this bug", "test this on mobile", "validate PR #123", or asks whether a pull request can be approved. Covers core, modules, themes and libraries, front office and back office, and checks the narrow viewports for layout regressions.
compatibility: Needs an environment the developer can switch between two states, an agent with shell access, node, git, and gh authenticated for the repository. The rest follows the probe. A browser run also needs the shop reachable over HTTP, npm and Playwright, installed on first use into a temporary directory. A command-line run needs none of those three. An HTTP run needs the shop reachable. Docker is optional, and only saves asking which directories are served.
---

# QA a PrestaShop pull request

Run the pull request's own test steps against a running environment twice: once on the code as it was **before** the PR, once on the PR's code. Record both runs. The deliverable is one verdict (**approved**, **not approved** or **not reproducible**) with the recording that backs it up.

How the environment is observed depends on what the PR changes. Three probes, one set of rules:

| Probe | For a PR that changes | Evidence |
| --- | --- | --- |
| `browser` | what a page shows: templates, JS, CSS, forms, the back office | paired screenshots and a video |
| `cli` | what a command does: console commands, module CLIs, install and upgrade scripts | paired transcripts, exit codes, files touched |
| `http` | what the server answers: the webservice, JSON controllers, status codes, redirects | paired requests with status and body |

Everything after the probe is identical, and that is the point: two phases in the same order, the same scenario in both, the same flake rule, the same reasons to refuse a verdict.

## Terms used in this skill

The left column is what the files and the code call things: `before/` is a real directory, `--phase=before` is a real argument, `flaky` is a real field in `phase.json`. Renaming them in prose only would leave the words and the data saying different things.

The right column is what they mean, and **the right column is what you say out loud.** Never make the person you are talking to learn this table.

| Term | What it means, in plain words |
| --- | --- |
| `before` phase | the measurement taken on the code as it was **before the fix, or before the new feature**, where the bug must show |
| `after` phase | the measurement taken on **the pull request's code**, where the bug must be gone, or the new feature must work |
| merge base | the commit the pull request branched from: the base branch as it was, without other people's later merges |
| canary reading | a quick check that the server really is serving the new code, and not a cached copy of the old one |
| bug assertion | the one check that can prove the bug. Written in the words of the person who reported it |
| precondition | something that must be true in both measurements. If it is not, the environment is unusable and there is nothing to compare |
| harness error | the measurement itself cannot be trusted. There is no verdict, and it is never the pull request's fault |
| flake | a check that failed, then passed when it was read a second time |
| smoke | a handful of shallow checks on things the ticket never mentions, asking only "is it still alive". The name comes from powering up a new circuit board and watching for smoke: if it smokes, stop, there is no point running the careful measurements |
| probe | how the environment is observed: through a browser, on the command line, or over HTTP. It changes the measurement, never the rules |
| regression net | the checks run in both measurements that the ticket never asked for: the smoke pass, and the narrow viewports |

## Who you are talking to

The person running this QA may be a developer, an integrator, a QA engineer or a product manager. They know the environment and the ticket; they do not know this skill, and they should not have to.

- **Say the meaning, not the term.** "Put the environment back on the code as it was before the fix" rather than "put the environment in its pre-fix state". "I will check the server is really serving the new code" rather than "I will take a canary reading".
- **Every question you ask is one action with one reason.** Print the exact command, say in one sentence what it is for, and wait. Never ask for two things in the same breath.
- **Ask early whether they can change which code is running at all.** Someone who cannot run `git` on that machine is not a problem, but finding out at the third gate is: say so at the start, run the `after` measurement alone, and cap the verdict at "approved, reproduction not attempted".
- **Never guess what you can ask.** Three cases, and only three. If the person knows it, ask them: which probe fits, what the test steps are, which versions the environment runs. If the machine knows it, measure it and show the measurement rather than asserting it. If neither knows it, write that down in the report instead of filling the gap with something plausible. A QA report is worth exactly as much as the reader's confidence that nothing in it was assumed.
- **Read the verdict back in their words.** "The bug happened on the old code and is gone on the new one" is the sentence they need. The table below is how you got there, not what you report.

## Rules that do not bend

1. **The developer prepares the ground.** Anything that writes to their repository is theirs: a checkout, a fetch, a ref. A checkout can destroy uncommitted work, and it is their branch. Print the command, say what it is for, wait. Reading is yours: `gh pr view`, `gh pr diff`, `git merge-base` on refs that already exist.
2. **Everything derived from the code, the skill offers to run itself**: `composer install`, the build, `cache:clear`. The order matters: rebuild first, read the canary second.
3. `before` **runs first, always.** Migrations only run forward, so testing the PR first leaves the `before` run reading a migrated database.
4. **The same** `scenario.js` **runs in both phases, unchanged**, and so does the runner. Three hashes are recorded in each phase, the scenario, the runner and the shared recording rules; any mismatch voids the verdict.
5. **Nothing is ever posted to GitHub.** The comment is written to a file for the user to paste.
6. **Back-office credentials arrive as the** `QA_BO_EMAIL` **and** `QA_BO_PASSWORD` **environment variables**, never as command-line arguments: arguments end up in artifacts that get pasted into a public pull request.
7. **The scenario asserts; it never decides.** The verdict comes from the table in this file.
8. **Evidence never lands in the environment under test or in the checkout.** `scripts/pick-run-dir.sh` enforces this.

## What to ask the user

- the pull request: `owner/repo#number`, or its URL
- the front-office URL of the running shop
- the back-office URL and the admin folder name, if the PR touches the back office. That folder name differs on every installation
- the versions the environment runs, unless a command can print them: PrestaShop, PHP, and the version of the theme, module or library the PR is about. The report states them as fact, so they are asked for or measured, never assumed from a branch name
- whether they can put the environment back on the code as it was before the fix. Without that there is no `before` measurement, and the verdict is capped at "approved, reproduction not attempted"

Do not ask for paths on disk: `scripts/pick-run-dir.sh` derives them from the URL. Ask only if it refuses because the shop does not run in Docker.

## Workflow

A typical request: *QA the PR PrestaShop/hummingbird#1092 against [http://localhost:8887](http://localhost:8887)*. What follows is the whole run, from reading that PR to handing over a comment to paste.

Copy this checklist into your reply and tick items off as you go:

```
QA progress:
- [ ] 1. Read the PR and its linked issues
- [ ] 2. Set up the run directory, and Playwright for a browser run
- [ ] 3. Write scenario.js from the ticket's steps
- [ ] 4. GATE: show the scenario, ask for the code from before the fix
- [ ] 5. Measure the before phase
- [ ] 6. GATE: ask for the PR's code
- [ ] 7. Measure the after phase
- [ ] 8. Write verdict.json, render report.html, write report.md and comments/
```

### 1. Read the PR and its linked issues

```bash
gh pr view [number] --repo [owner/repo] \
  --json title,body,baseRefName,headRefOid,files,closingIssuesReferences
```

Read every linked issue with `gh issue view`. Labels are deliberately not fetched: this skill never sets one and never reads the queue, so pulling them would only add noise to what you have to read.

Then:

- Classify the PR as **bugfix** or **new feature**.
- Find the test steps. They sit in a table row of the PR body whose label is not standardised: `How to test?`, `How to test`, sometimes missing. Reproduction steps and the affected version are usually in the linked issue, not the PR. **If they exist in neither, ask the person before reading the diff**: they often know the reproduction by heart, and steps that come from a human beat steps reverse-engineered from a patch. Only if they cannot say, derive them from the diff, and then say in the report that they were inferred and from what.
- **Propose the probe, then confirm it.** The diff suggests one: templates, assets or a controller's output mean `browser`; a console command, an install or upgrade script, a composer script mean `cli`; a webservice resource or a JSON endpoint means `http`. Say which one you propose and why, in one sentence, and let them correct you. They know whether the ticket is about the page or the command; the diff only knows which files moved. A PR can need two, and then it gets two runs and one report per probe.
- **Stop here** if no probe can observe the change: CI config, documentation, tests only, a pure refactor. Say which it is, and that there is no verdict to give. Inventing steps for such a PR manufactures a verdict out of nothing.
- Check whether the PR silently depends on another PR before blaming the code. The probe is in [references/prestashop.md](references/prestashop.md).
- **If the diff is one-way, ask now whether this PR has already run here.** A checkout does not reset the database, and at the gate the question is too late. See [references/prestashop.md](references/prestashop.md).

### 2. Set up the run directory, and Playwright for a browser run

`SKILL_DIR` is the directory this file was read from. Both scripts print their reasoning to stderr and their one result to stdout.

```bash
RUN=$(sh "$SKILL_DIR/scripts/pick-run-dir.sh" "[front-office URL]" \
        "$HOME/prestashop-pr-qa/[owner]/[repo]/pr-[number]")

# Only for a browser run. A command-line or HTTP run needs neither Playwright nor npm.
NODE_PATH=$(sh "$SKILL_DIR/scripts/playwright-lab.sh"); export NODE_PATH
```

A run that never touches HTTP has no URL to give: pass `-` instead, and the guard skips the Docker lookup rather than falling back to port 80 and guarding whatever unrelated container publishes it. The checkout is still protected, and so is any directory you name after the run directory.

If `pick-run-dir.sh` exits non-zero, stop and read what it printed. It refuses when the evidence would land somewhere it could be committed or served over HTTP. When the shop does not run in Docker it asks for the served directory; pass it as a third argument.

One directory per owner, per repository, per pull request, as in `PrestaShop/hummingbird/pr-1092`. Each segment is exactly one identifier, so a repository whose name contains a hyphen stays readable, and `ls ~/prestashop-pr-qa/[owner]/` answers "which repositories have I QA'd" without parsing anything.

Tell the user the run directory now, and again at the end, so the files are findable when the comment gets pasted. It holds:

| Path | What it is |
| --- | --- |
| `report.html` | **what the developer opens**: the verdict, the paired screenshots, the video, the comment to paste |
| `verdict.json` | the judgement, machine-readable. The one place a verdict is written; both reports render it |
| `report.md` | the same run in text, for grepping and for tickets that do not render HTML |
| `scenario.js` | the script that was run, kept so anyone can repeat the run |
| `before/`, `after/` | `phase.json` always. Then `video.webm` and one `NN-slug.png` per step for a browser run, or `transcript.txt` for a command-line or HTTP run |
| `comments/` | one file per GitHub target, holding **only** what to paste there |
| `env/` | PR metadata, the tokens the diff adds, the canary readings, the guarded paths |

The run directory is **reused** across passes on the same PR; a phase directory is not. The runner empties `before/` or `after/` itself before measuring it, so an earlier pass's video can never be read as this run's proof. Move a pass aside first (`mv before before-01`) if it is worth keeping. Whatever you do find in a phase directory is only evidence if its `phase.json` hashes match the `scenario.js` and the runner about to run; otherwise treat that phase as absent and say so.

### 3. Write scenario.js from the ticket's steps

Write it from the **ticket's** steps first. Read the diff only afterwards, and only to find which page to open and whether a build is needed. One `step()` per test step. The template, the assertion kinds and the runner's API are in [references/runner.md](references/runner.md).

**In a browser run**, call `clip()` once, in the step where the symptom is visible, naming a container that exists in both phases. The report leads with that clipped pair, which is what makes it readable. A command-line or HTTP run has nothing to clip: its evidence is the paired transcript. See [references/runner.md](references/runner.md).

If the ticket is about mobile, declare `viewport: 'mobile'` in the scenario, so the bug is measured at the width where it was reported. Browser runs only. See [references/runner.md](references/runner.md).

Then derive `surfaces`, the pages this PR touches on both sides of the shop, and propose the list before writing it into the scenario. On a back-office PR this is what catches the breakage the ticket never thought to mention. See [references/runner.md](references/runner.md).

Then check every bug assertion against the tokens the diff adds. The recipe is in [references/runner.md](references/runner.md). A bug assertion naming a class, id or attribute the PR introduces proves nothing: on the code from before the fix that selector is simply absent, the check fails, and the run claims a reproduction it never made. Rewrite it in the words of the ticket.

### 4. GATE: show the scenario, ask for the code from before the fix

Show the scenario. Then print the exact commands that put the environment back on the code from before the fix, with the reason for each:

| Command | Why | Matters for |
| --- | --- | --- |
| `git checkout [merge base]` | the merge base is the code the PR branched from; the tip of the base branch carries other people's later merges | every probe |
| `composer install --no-dev` | mandatory for a module: its `vendor/` is not in git, and its classes autoload through it | every probe |
| `cache:clear` | PHP, Twig, YAML and service definitions are compiled into the container, and a console command reads that container too | every probe |
| the theme or asset build | compiled CSS and JS only exist once built | browser only |
| restart PHP-FPM, or wait out the opcache | the web server keeps compiled PHP in memory | browser and HTTP only. A command-line run starts a fresh process each time, so it never sees a stale opcache |

Offer to run everything except `git`, so the rebuild happens before the canary reading. `git` stays with the developer, because a checkout can destroy uncommitted work. Then **wait**.

Skip the `before` phase, saying why, when a checkout cannot reset the database and no snapshot exists. Step 1 is where that was decided. For a new feature there is nothing to reproduce: go to step 6.

Name any fixture data or configuration change out loud before creating it, and list it in the report.

### 5. Measure the before phase

```bash
curl -s -L '[url]' | grep -c '[string the PR introduces]'   # the canary reading

# browser
( cd "$RUN" && node "$SKILL_DIR/scripts/run.js" \
    --scenario=./scenario.js --phase=before --out=. --url="[FO URL]" --bo-url="[BO URL]" )
# command line
( cd "$RUN" && node "$SKILL_DIR/scripts/run-cli.js" \
    --scenario=./scenario.js --phase=before --out=. --cwd="[the checkout under test]" )
# HTTP
( cd "$RUN" && node "$SKILL_DIR/scripts/run-http.js" \
    --scenario=./scenario.js --phase=before --out=. --url="[base URL]" )
```

The `cd` stays inside a subshell: a bare `cd` moves the session out of the repository and breaks the `git` and `gh` commands in the steps that follow.

`curl` has no cache, no service worker and no profile, so it reports what the server actually serves. A back-office change has to be read in the browser instead. See [references/prestashop.md](references/prestashop.md).

The canary proves the environment really changed between the phases, so it follows the probe too: for a `cli` run it is the command printing something the PR introduces, for an `http` run it is the endpoint answering differently. Record both readings in `verdict.json` either way.

### 6. GATE: ask for the PR's code

Print the commands, wait, then take the second canary reading.

### 7. Measure the after phase

Same as step 5 with `--phase=after` (the runner clears the directory itself), then compare the two canary readings. **Identical readings mean the environment never changed state**: a stale Symfony or Smarty cache, an untouched opcache, or a URL served from a different directory than the one that was switched. That is a harness error: say so and stop, with no verdict.

### 8. Write the verdict, then the reports

Apply the verdict table below, and write the judgement **once**, into `verdict.json`. Then render the page, which reads that file and both `phase.json` and invents nothing:

```bash
node "$SKILL_DIR/scripts/report.js" --run="$RUN"
```

Write `report.md` too: the same facts as text, for grepping and for tools that do not render HTML. Then write `comments/`, tell the user the `pbcopy` command for each target, where `report.html` is, and which state the environment was left in with the command that restores it.

The shape of `verdict.json`, what belongs in each report and the rules for the text that gets pasted on GitHub are in [references/reporting.md](references/reporting.md). Three of those rules matter enough to repeat here, because breaking them is published rather than merely untidy: nothing is ever posted automatically, nothing in a comment addresses the person pasting it, and no comment carries a path from your disk.

## Verdict

| Kind | `before` | `after` | Verdict |
| --- | --- | --- | --- |
| bugfix | reproduced | all pass | 🟢 approved |
| bugfix | reproduced | a bug assertion fails | 🔴 not approved, the fix does not fix it |
| bugfix | did not reproduce | any | 🟡 not reproducible: neither approval nor rejection. Ask the reporter for the version and the steps |
| bugfix | not attempted | all pass | 🟢 approved, reproduction not attempted (the caveat goes on line 1, not in a footnote) |
| bugfix | not attempted | a bug assertion fails | 🔴 not approved: the documented steps do not produce the documented result |
| feature | n/a | all pass | 🟢 approved |
| feature | n/a | any fails | 🔴 not approved |
| any | n/a | n/a | ⚫ not applicable: no probe can observe what the diff changes |

A check that fails in **both** phases is pre-existing: report it, do not hold it against the PR.

A surface the PR touches that answered in `before` and fails in `after` is 🔴 **not approved** on its own, even when every bug assertion passed. The fix working on the page the ticket names does not license breaking the page next to it.

### The pages the PR touches

The smoke pass covers what the ticket never mentions. This covers what it does, and they are not the same question. A back-office change reaches the front office through the model the two share, and that is where a migration breaks something nobody looked at: the migrated page is perfect and the front-office page built on the same model renders nothing.

The scenario declares them as `surfaces`, one entry per page, prefixed by the side it lives on: `surfaces: ['bo:/<the route under test>', 'fo:<the page built on the same code>']`.

**Derive the list from the diff, then ask.** Say which pages you propose and why, in one sentence, and let the user correct you: they know whether the ticket has a front-office side. Each surface is opened in both phases and asked whether it answers, is not a fatal page, and rendered anything. The recipe, and the one case that is a failed measurement rather than a failed page, are in [references/runner.md](references/runner.md).

### The regression net

Every phase also runs checks the ticket never asked for. The smoke pass runs under every probe. **In a browser run** it is joined by the front page plus up to two of the pages the scenario opened, re-visited at **375 and 768 wide**. A command-line or HTTP run has no viewport, so the net there is the smoke pass alone, and the report says so.

The smoke pass follows `where`. A front-office or mixed PR gets the front page, a product page, the cart, and the back office when its URL was given. A back-office PR loses the cart and the product page, which it cannot break: what is left is the back office, proving the container still builds, and the front page, proving the shop still answers. What that PR does touch is covered by `surfaces` above. Each page is asked one thing: did it answer under 400, and is the body not a fatal error page. **In a browser run that list is not configurable**, on purpose: one the agent could choose would drift towards the ticket, which is exactly what it must not cover. A command-line or HTTP scenario declares its own with `smoke`. The narrow pass asks only whether the shop still works at that width: the page responds, it renders visible content, it does not scroll sideways. It never judges the design.

Everything is measured in both phases, which is the whole point: the comparison is what makes a finding attributable.

| Finding | In `before` | In `after` | How to report it |
| --- | --- | --- | --- |
| a narrow page with `ok: false`, or a smoke page that fails | no | yes | 🔴 **introduced by this PR.** Name the page, the width, which of `responds` / `rendered` / `overflowPx` failed, and the boxes `phase.json` lists. Set the verdict to not approved even when every bug assertion passed |
| the same finding | yes | yes | 🟡 pre-existing. Report it, do not hold it against the PR |
| the same finding | yes | no | 🟢 the PR fixed it as well. Say so in one line |

Nothing else about the narrow layouts is asserted, on purpose: a cramped price, a button on two lines, a stretched image are for a human to judge. The `mobile-*.png` and `tablet-*.png` pairs sit in the run directory for exactly that, and the report points at them instead of pretending to judge them.

A **flake** means two different things depending on the phase:

- in `before`, the symptom appeared and then cleared. It was still observed, so the row stays **reproduced**, with the word *intermittent* on line 1 of the verdict. An intermittent bug is a real bug, and the reporter needs to know it was not seen every time.
- in `after`, the settled reading is the one that counts. The phase passes, and the report says the first reading was taken too early.

Neither voids the verdict. `phase.json` marks both as `flaky: true`, and the `before` case as `intermittent`.

**Refuse to give any verdict at all**, which is a harness error and never a PR failure, when:

- `scenarioSha256` differs between the two phases
- `runnerSha256` or `recordSha256` differs between them (two different programs, or two different sets of recording rules, judged them; they are not comparable)
- the two canary readings are identical
- a precondition failed
- a selector matched nothing
- a bug assertion names markup the PR introduces

### Severity markers

| Marker | Severity | Meaning |
| --- | --- | --- |
| 🔴 | Blocker | Introduced by this PR. Not approved |
| 🟡 | Warning | Pre-existing, or outside what was covered. Noted, does not block |
| 🟢 | OK | Asserted, and observed by the probe that ran |

## Troubleshooting

| What you see | Cause | What to do |
| --- | --- | --- |
| `refusing: nothing publishes port N` | the shop is not in Docker, so nothing declares what it serves | ask which directory the web server serves, pass it as a third argument to `pick-run-dir.sh` |
| `refusing: <dir> is inside <dir>` | the run directory would be committed into the PR or served over HTTP | pick a run directory outside the shop and outside the checkout, e.g. under `$HOME` |
| `node is not on PATH` | node is installed through nvm or asdf, which a non-interactive shell does not load | ask the user to run the QA from a shell where `node -v` works |
| the two canary readings are identical | the code never changed: a stale Symfony or Smarty cache, an untouched opcache, or a URL served from another directory | offer to run `cache:clear` and the build, then read the canary again. If it still matches, stop: there is no verdict |
| a precondition failed in one phase | the environment differs between the two phases, so the two runs are not comparable | fix the environment and rerun that phase. Never report a verdict from it |
| `selector matched 0, expected 1..` | the scenario names markup that is absent in that phase | rewrite the check in the words of the ticket, using a selector that exists in both phases |
| a page overflows sideways in **both** phases | pre-existing responsive defect, not this PR | report it as 🟡 with the width and the page, and move on |
| the bug fails in **both** phases | pre-existing, not caused by this PR | report it as 🟡 and do not hold it against the PR |
| a module change is invisible in the shop | a module has to be reset in the Module Manager for its new code to apply | reset the module, then read the canary again. See [references/prestashop.md](references/prestashop.md) |
| a runner is not found, `scripts/run.js` or `run-cli.js` or `run-http.js` | the skill was installed incompletely | reinstall the skill; the runners ship with it and are never written by hand |

## Bundled files

| File | What is in it |
| --- | --- |
| [references/runner.md](references/runner.md) | the three probes and what each hands a scenario, the scenario template, the diff-token recipe, and the checks that pass for the wrong reason |
| [references/prestashop.md](references/prestashop.md) | where the code sits, caches and builds, module `vendor/`, back-office tokens, one-way migrations, the PR-dependency probe |
| [references/reporting.md](references/reporting.md) | the shape of `verdict.json`, what goes in each report, and the rules for the comment that gets pasted |
| [references/design.md](references/design.md) | the colours, type, spacing and layout `report.js` inlines, and what a report deliberately does differently from the reference |
| `scripts/record.js` | the half of a phase every probe shares: what counts as a precondition, what proves a bug, what a flake means, what `phase.json` holds |
| `scripts/run.js` | runs one phase in a browser. Executed, never edited for a run |
| `scripts/run-cli.js` | runs one phase on the command line. Needs neither Playwright nor npm |
| `scripts/run-http.js` | runs one phase over HTTP. Needs neither Playwright nor npm |
| `scripts/report.js` | renders `report.html` from `verdict.json` and the two `phase.json`. Presents; never decides |
| `scripts/pick-run-dir.sh` | picks the run directory and refuses one that would leak the evidence |
| `scripts/playwright-lab.sh` | finds or installs a working Playwright outside the environment under test. Browser runs only |

