---
name: prestashop-pr-qa
description: QA a PrestaShop pull request in a real browser and write a report saying whether it is approved, with video and screenshots as proof. Use when asked to QA or test a PR, to reproduce a bug and confirm a fix, or to verify a PR's "How to test" steps against a running shop.
---

# PrestaShop - QA a pull request in a real browser

Run the pull request's own test steps against a shop that is already running, and record what
happens. The deliverable is a report carrying a verdict — **approved**, **not approved** or **not
reproducible**. The video and the screenshots exist to back up what it says.

Division of labour: **the developer owns `git`; the skill owns everything downstream of it.**
Changing which code is checked out is never the skill's call — it can destroy uncommitted work, and
it is the developer's branch. Regenerating derived state from whatever code is present —
`composer install`, the build, `cache:clear` — the skill offers to run itself, because the order
matters and it knows it: rebuild first, read the canary second. Either way it verifies the shop is
really in the claimed state before measuring anything.

## Requirements

Ask the user:
* The pull request to QA: `owner/repo#number`, or its URL.
* The front-office URL of the running shop to test against.
* The back-office URL and the admin folder name, if the PR touches the back office. That folder name differs on every installation.
* The back-office credentials, if they are needed. Take them as the `QA_BO_EMAIL` and `QA_BO_PASSWORD` environment variables, never as command-line arguments — arguments end up in artifacts that get pasted into GitHub.
* Whether the shop can be put in its **pre-fix state**, meaning the code as it was before the PR. Without it there is no reproduction phase, and the verdict is capped at "approved — reproduction not attempted".

## Usage:

* Two phases, always in this order: `before` (pre-fix code, where the bug must show) then `after` (the PR's code, where it must be gone). The order is a safety property, not a preference: database migrations, module upgrade scripts and new configuration keys only run forward, so testing the PR first leaves the `before` run reading an already-migrated database.
* The **same** scenario script runs in both phases, unchanged.
* Everything lands in a **run directory outside the shop**: `~/prestashop-pr-qa/[owner]-[repo]-pr-[number]/`. Never write artifacts into the shop, the theme, the module or any git working tree — a bind-mounted theme or module is both committable by accident and **served over HTTP**, which would publish the video and the screenshots. Confirm the choice before writing anything:

```bash
RUN="$HOME/prestashop-pr-qa/[owner]-[repo]-pr-[number]"
mkdir -p "$RUN/env"
RUN_REAL=$(cd "$RUN" && pwd -P)

# Refuse if it sits inside the checkout under test or the shop's document root: the first gets
# committed into the pull request, the second gets served over HTTP.
for GUARD in "$CHECKOUT" "$SHOP_ROOT"; do
  [ -d "$GUARD" ] || continue
  case "$RUN_REAL/" in "$(cd "$GUARD" && pwd -P)"/*)
    echo "refusing: $RUN_REAL is inside $GUARD"; exit 2 ;;
  esac
done

# Inside any other git work tree — a dotfiles repository, say — is merely untidy: warn, continue.
TOP=$(git -C "$RUN_REAL" rev-parse --show-toplevel 2>/dev/null) &&
  echo "note: inside the git work tree $TOP — keep it out of commits"
```

  Tell the user the path up front, and again at the end so the files are findable when the comment
  gets pasted. Do not use `$TMPDIR` for artifacts: the evidence has to outlive the session, because
  it is attached to the pull request by hand. `$TMPDIR` is for the Playwright lab, which is
  disposable.

* The run directory holds:

| Path | What it is |
|:---|:---|
| `report.md` | The deliverable: verdict, evidence, and a ready-to-paste PR comment at the end |
| `scenario.js` | The script that was actually run, kept so anyone can repeat the run |
| `run.js` | The phase runner, copied unchanged from `references/runner.md` |
| `before/`, `after/` | `video.webm`, one `NN-slug.png` per step, and `phase.json` |
| `comments/` | One file per GitHub target, each containing **only** what to paste there |
| `env/` | PR metadata, the tokens the diff adds, and the canary readings |

* Nothing is ever posted to GitHub. The comment is handed over for the user to paste.

## Steps

- Read the PR: `gh pr view [number] --repo [owner/repo] --json title,body,baseRefName,headRefOid,files,closingIssuesReferences,labels`, then read every linked issue with `gh issue view`. Classify it as **bugfix** or **new feature**.
- Find the test steps. In a PrestaShop PR body they sit in a table row whose label is not standardised — `How to test?`, `How to test`, sometimes missing entirely. Reproduction steps and the affected version usually live in the linked issue rather than the PR. If they exist in neither, derive them from the diff and **state in the report that they were inferred**.
- Stop early if the diff changes nothing a browser can observe — CI configuration, documentation, tests only, a pure refactor with no behavioural change. Say which of those it is and that there is no browser verdict to give. Inventing steps for such a PR manufactures a verdict out of nothing.
- Check whether the PR silently depends on another PR before blaming the code: a symbol the diff adds that exists nowhere in the shop is a missing dependency, not a defect. The probe is in `references/prestashop.md`.
- Write the scenario from the **ticket's** steps first. Read the diff only afterwards, and only to find which page to open and whether a build is needed. One `step()` per test step. The template and the three assertion kinds are in `references/runner.md`.
- Grep every bug assertion against the tokens the diff adds (`env/diff-added-tokens.txt`, recipe in `references/runner.md`). A bug assertion naming a class, id or attribute the PR introduces proves nothing: in the pre-fix state that selector is simply absent, the check fails, and the run claims a reproduction it never made. Rewrite it in the words of the ticket before running anything.
- Show the scenario to the user. Then ask for the pre-fix state and wait (GATE). Print the exact commands and say why each one is needed — the merge-base is the true pre-fix state because the base branch tip carries other people's merges; `composer install --no-dev` is mandatory for modules because `vendor/` is not in git; the build is needed only if the diff touches compiled sources; `cache:clear` is needed for PHP, Twig and YAML changes. Offer to run those three yourself, in the path the developer named, so the rebuild happens before the canary reading rather than after it; leave the `git` command to them. For a new feature there is nothing to reproduce: skip to the `after` phase.
- Skip the `before` phase, saying why, when the diff touches something a code downgrade cannot undo: `install/upgrade/sql/`, `upgrade/upgrade-*.php`, `ALTER TABLE`, `ADD COLUMN`, or hook registration inside `install()`.
- Take a canary reading, then run the `before` phase. The canary is `curl -s -L '[url]' | grep -c '[string the PR introduces]'` (for a back-office change it must be read in the browser instead — see `references/prestashop.md`) — curl has no cache, no service worker and no profile, so it reports what the server actually serves.
- Ask for the PR's code and wait (GATE). Take a second canary reading, then run the `after` phase.
- Compare the two canary readings. Identical readings mean the shop never changed state — a stale Symfony or Smarty cache, an untouched opcache, or a URL served from a different directory than the one that was switched. That is a harness error and there is no verdict; say so and stop.
- Write `report.md`, applying the verdict table below. The scenario asserts; it must never decide the verdict.
- Write `comments/` and tell the user the exact `pbcopy` command per target. Never post anything yourself.
- Tell the user which state the shop was left in, and the command that returns it to where it started.
- Name any fixture data or configuration change out loud before creating it (GATE), and list it in the report under what was added.

### Verdict

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

Refuse to produce any verdict at all — this is a harness error, never a PR failure — when the
scenario file's hash differs between the two phases, when the canary readings are identical, when
a precondition failed, when a selector matched nothing, or when a bug assertion names markup the
PR introduces.

### Severity levels

| Marker | Severity | Meaning                                                            |
|:-------|:---------|:-------------------------------------------------------------------|
| 🔴     | Blocker  | Introduced by this PR. Not approved                                |
| 🟡     | Warning  | Pre-existing, or outside what was covered. Noted, does not block   |
| 🟢     | OK       | Asserted and observed in the browser                               |

### Report layout

`report.md`, in this order: the verdict as the H1 with any caveat immediately under it; the
environment (URLs, PrestaShop and PHP versions, the two states tested, the commands run in each
phase and who ran them, the Playwright and Chromium versions, the state the shop was left in); the classification and
**where the steps came from**; reproduction; verification; the regression net, ending with the
sentence `Regression coverage: smoke only.`; the honesty checks (script hash identical across
phases, preconditions, canary readings, bug assertions referencing PR-introduced markup, flake
re-samples); what was not tested; the verdict and one sentence of reasoning; a
pointer to `comments/` for what to post; and the artifact tree.

### What to post on GitHub

`report.md` is for the person who ran the QA. It is not what goes on GitHub — it is too long, it
carries local paths, and a fenced block inside it has to be hand-selected and un-indented before it
can be pasted. Write the GitHub text as its own files instead:

```text
comments/
├── index.md                          # what to post where, and in what order
├── PrestaShop-hummingbird-1092.md    # paste this, whole, into that PR
└── PrestaShop-PrestaShop-42356.md    # a second target only if the verdict covers it too
```

Rules for a file in `comments/`:

* **Its entire content is the comment.** No surrounding fence, no report headings, nothing to trim. The user should be able to run `pbcopy < comments/[file].md` and paste, so tell them that command.
* One file per GitHub target. Never one file that says "and post this part over there".
* Named `[owner]-[repo]-[number].md`, so the target is unambiguous.
* First line is the verdict. Second line is the standing disclaimer: `Note: AI-generated QA review. The tooling is still being tested — please sanity-check the verdict.`
* No absolute paths, no run-directory paths, no credentials — the reader cannot see your disk.
* Name the files to attach by hand, because images and video cannot be uploaded programmatically.
* At most about 15 lines before the attachment line. The detail lives in `report.md`, which stays local.

A second file is written **only** when the verdict genuinely covers another repository — a theme PR
that needed a core PR applied alongside it, say. In that case each comment is written for its own
readers: the theme PR's comment cannot assume they know about the core PR, and both must state that
the result covers the combination rather than either PR alone.

`index.md` lists each file with its target URL and one line on why it is being posted. With a single
target it is one line long, and that is fine — it is the thing the user reads to know they are done.

Reference screenshots paired by step index, so a reviewer can see both states of the same moment:

| # | Step | before | after |
|:--|:---|:---|:---|
| 03 | observe the symptom | `before/03-observe-the-symptom.png` | `after/03-observe-the-symptom.png` |

Write it flat: no emoji outside the severity markers, no first person, no hedging, no praise, and
no restating the diff.

## References

* `references/runner.md` — how to stand up Playwright, record video and per-step screenshots, the scenario template, the assertion kinds, and the checks that pass for the wrong reason.
* `references/prestashop.md` — back-office login and tokens, caches, builds, module `vendor/`, one-way migrations, and the PR-dependency probe.
