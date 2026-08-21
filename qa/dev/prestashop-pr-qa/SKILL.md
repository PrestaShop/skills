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
* Nothing about paths on disk. Asking a developer to type a document root is asking a technical question they may answer wrongly, and it is not needed: the front-office URL already identifies the container that serves the shop, and that container declares what it mounts (the block below). The only case that needs a question is a shop running outside Docker, where nothing on the machine knows what is served.
* Whether the shop can be put in its **pre-fix state**, meaning the code as it was before the PR. Without it there is no reproduction phase, and the verdict is capped at "approved — reproduction not attempted".

## Usage:

* Two phases, always in this order: `before` (pre-fix code, where the bug must show) then `after` (the PR's code, where it must be gone). The order is a safety property, not a preference: database migrations, module upgrade scripts and new configuration keys only run forward, so testing the PR first leaves the `before` run reading an already-migrated database.
* The **same** scenario script runs in both phases, unchanged.
* Everything lands in a **run directory outside the shop**: `~/prestashop-pr-qa/[owner]-[repo]-pr-[number]/`. Never write artifacts into the shop, the theme, the module or any git working tree — a bind-mounted theme or module is both committable by accident and **served over HTTP**, which would publish the video and the screenshots. Confirm the choice before writing anything:

```bash
RUN="$HOME/prestashop-pr-qa/[owner]-[repo]-pr-[number]"
FO="[the front-office URL, from Requirements]"
case "$RUN$FO" in *'['*) echo "refusing: a placeholder was left unsubstituted"; exit 2 ;; esac

# The directories the evidence must stay out of. Nothing to ask for: the URL under test names the
# port, the port is published by one container, and that container declares what it mounts.
HOSTPORT=$(printf '%s' "$FO" | sed -E 's#^[a-zA-Z]+://##; s#/.*$##')
case "$HOSTPORT" in
  *:*) PORT=${HOSTPORT##*:} ;;
  *)   case "$FO" in https://*) PORT=443 ;; *) PORT=80 ;; esac ;;
esac

CIDS=""
CID=$(docker ps --format '{{.ID}} {{.Ports}}' 2>/dev/null | grep -E ":$PORT->" | awk '{print $1}' | head -1)
if [ -n "$CID" ]; then
  # The whole compose project, not just that one container: nginx publishes the port while
  # php-fpm and the theme mount the code, and all of it is the same shop.
  PROJECT=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$CID" 2>/dev/null)
  if [ -n "$PROJECT" ]; then CIDS=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT"); else CIDS=$CID; fi
  echo "port $PORT is served by $(docker inspect --format '{{.Name}}' "$CID" | sed 's#^/##')${PROJECT:+, compose project $PROJECT}"
fi

# No container on that port means the shop is not in Docker, and then nothing on this machine knows
# what the web server serves. That is the one case worth a question: ask which directory is served,
# add it to the list, and run this again. An empty list is never a pass.
[ -n "$CIDS" ] || { echo "refusing: nothing publishes port $PORT — ask which directory the web server serves"; exit 2; }

# Every host directory the shop bind-mounts, plus the checkout itself. Not only the document root:
# a mounted theme or module is both committable by accident and reachable over HTTP.
GUARDS=$(
  git rev-parse --show-toplevel 2>/dev/null
  docker inspect --format '{{range .Mounts}}{{if eq .Type "bind"}}{{println .Source}}{{end}}{{end}}' $CIDS 2>/dev/null
)
GUARDS=$(printf '%s\n' "$GUARDS" | sed '/^$/d' | sort -u)
[ -n "$GUARDS" ] || { echo "refusing: the shop was found but declares no directory to guard"; exit 2; }

# Resolve $RUN without creating it, so the decision happens before anything is written: walk up to
# the deepest ancestor that does exist, resolve that, then put the missing tail back.
LEAF=""; PROBE="$RUN"
while [ ! -d "$PROBE" ]; do
  LEAF="$(basename "$PROBE")${LEAF:+/$LEAF}"; PROBE="$(dirname "$PROBE")"
done
RUN_REAL="$(cd "$PROBE" && pwd -P)${LEAF:+/$LEAF}"

# Read from a file, not from a pipe: the loop has to run in this shell for `exit` to stop the
# script, and a `case` pattern inside `$(...)` does not parse on the bash macOS still ships.
LIST="${TMPDIR:-/tmp}/qa-guards.$$"
printf '%s\n' "$GUARDS" > "$LIST"
echo "keeping the evidence out of:"; sed 's/^/  /' "$LIST"
while IFS= read -r G; do
  [ -d "$G" ] || continue
  case "$RUN_REAL/" in "$(cd "$G" && pwd -P)"/*)
    echo "refusing: $RUN_REAL is inside $G"; rm -f "$LIST"; exit 2 ;;
  esac
done < "$LIST"

# Cleared: create it, or reuse it if a previous pass on this PR already did.
mkdir -p "$RUN_REAL/env"
mv "$LIST" "$RUN_REAL/env/guarded-paths.txt"
[ -f "$RUN_REAL/report.md" ] && echo "note: reusing an existing run directory — a previous pass left report.md here"

# Inside any other git work tree — a dotfiles repository, say — is merely untidy: warn, continue.
TOP=$(git -C "$RUN_REAL" rev-parse --show-toplevel 2>/dev/null) &&
  echo "note: inside the git work tree $TOP — keep it out of commits"

# Last line on purpose: the block must exit 0 when it cleared, and the `git` probe above fails
# with 128 outside a repository, which would otherwise read as a refusal.
echo "run directory: $RUN_REAL"
```

  Show the list, do not turn it into a question: the shop identified itself through the URL, and
  the container that publishes that port is the authority on what it serves. Ask only when the
  block refuses — no container on that port (a native install, an Apache alias, a tunnel in front
  of the shop), where the served directory has to come from the developer. Whatever they name is
  added to the list and the block runs again. A detected path is never dropped from the list
  without the reason being recorded in the report.


  Tell the user the path up front, and again at the end so the files are findable when the comment
  gets pasted. Do not use `$TMPDIR` for artifacts: the evidence has to outlive the session, because
  it is attached to the pull request by hand. `$TMPDIR` is for the Playwright lab, which is
  disposable.

* **The run directory is reused, the phase directory is not.** The same PR gets QA'd more than once — a second pass keeps the path and whatever the first one left there. What must not survive is evidence: `rm -rf` the phase directory (`before/` or `after/`) immediately before measuring that phase, so a video from an earlier pass can never be read as this run's proof. Two nets for anything that survives anyway: a `phase.json` whose `scenarioSha256` differs from the `scenario.js` about to run, or whose `runnerSha256` differs from the `scripts/run.js` about to be invoked, is **not** evidence for this run — treat that phase as absent and say so; and `report.md` is rewritten in place, so if one was already there, note in the new one that it replaces an earlier pass. A developer who wants the earlier pass intact moves it aside first (`mv before before-01`); never let two passes write into the same phase directory.

* The run directory holds:

| Path | What it is |
|:---|:---|
| `report.md` | The deliverable: verdict, evidence, and a ready-to-paste PR comment at the end |
| `scenario.js` | The script that was actually run, kept so anyone can repeat the run. The runner is **not** copied here: it ships with the skill at `scripts/run.js`, and its hash is recorded in `phase.json` |
| `before/`, `after/` | `video.webm`, one `NN-slug.png` per step, and `phase.json` |
| `comments/` | One file per GitHub target, each containing **only** what to paste there |
| `env/` | PR metadata, the tokens the diff adds, and the canary readings |

* Nothing is ever posted to GitHub. The comment is handed over for the user to paste.

## Steps

- Read the PR: `gh pr view [number] --repo [owner/repo] --json title,body,baseRefName,headRefOid,files,closingIssuesReferences,labels`, then read every linked issue with `gh issue view`. Classify it as **bugfix** or **new feature**.
- Find the test steps. In a PrestaShop PR body they sit in a table row whose label is not standardised — `How to test?`, `How to test`, sometimes missing entirely. Reproduction steps and the affected version usually live in the linked issue rather than the PR. If they exist in neither, derive them from the diff and **state in the report that they were inferred**.
- Stop early if the diff changes nothing a browser can observe — CI configuration, documentation, tests only, a pure refactor with no behavioural change. Say which of those it is and that there is no browser verdict to give. Inventing steps for such a PR manufactures a verdict out of nothing.
- Check whether the PR silently depends on another PR before blaming the code: a symbol the diff adds that exists nowhere in the shop is a missing dependency, not a defect. The probe is in `references/prestashop.md`.
- Write the scenario from the **ticket's** steps first. Read the diff only afterwards, and only to find which page to open and whether a build is needed. One `step()` per test step. The template, the assertion kinds and the runner's API are in `references/runner.md`.
- Grep every bug assertion against the tokens the diff adds (`env/diff-added-tokens.txt`, recipe in `references/runner.md`). A bug assertion naming a class, id or attribute the PR introduces proves nothing: in the pre-fix state that selector is simply absent, the check fails, and the run claims a reproduction it never made. Rewrite it in the words of the ticket before running anything.
- Show the scenario to the user. Then ask for the pre-fix state and wait (GATE). Print the exact commands and say why each one is needed — the merge-base is the true pre-fix state because the base branch tip carries other people's merges; `composer install --no-dev` is mandatory for modules because `vendor/` is not in git; the build is needed only if the diff touches compiled sources; `cache:clear` is needed for PHP, Twig and YAML changes. Offer to run those three yourself, in the path the developer named, so the rebuild happens before the canary reading rather than after it; leave the `git` command to them. For a new feature there is nothing to reproduce: skip to the `after` phase.
- Skip the `before` phase, saying why, when the diff touches something a code downgrade cannot undo: `install/upgrade/sql/`, `upgrade/upgrade-*.php`, `ALTER TABLE`, `ADD COLUMN`, or hook registration inside `install()`.
- Locate `scripts/run.js` and check `node` is on PATH before the first phase — the recipe is in `references/runner.md`. Print its path and hash: the report has to name the program that produced the verdict.
- Clear `before/`, take a canary reading, then run the `before` phase. The canary is `curl -s -L '[url]' | grep -c '[string the PR introduces]'` (for a back-office change it must be read in the browser instead — see `references/prestashop.md`) — curl has no cache, no service worker and no profile, so it reports what the server actually serves.
- Ask for the PR's code and wait (GATE). Clear `after/`, take a second canary reading, then run the `after` phase.
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

A bug assertion that only settled on its second reading is a **flake**, and it means two different
things depending on the phase. In `before` the symptom appeared and then cleared: it was observed,
so it still counts as **reproduced**, and the verdict keeps its row in the table with the word
**intermittent** on line 1 next to it — an intermittent bug is a real bug and the reporter needs to
know it was not seen every time. In `after` the settled reading is the one that counts: the phase
passes, and the report says the first reading was taken too early. Neither case voids the verdict —
a flake is reported, never fatal. `phase.json` carries them as `flaky: true`, with `intermittent`
marking the `before` case, and both belong in the honesty checks.

Refuse to produce any verdict at all — this is a harness error, never a PR failure — when the
scenario file's hash differs between the two phases, when `runnerSha256` differs between them — the
two phases were then judged by different programs and are not comparable — when the canary readings
are identical, when
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
phase and who ran them, the Playwright and Chromium versions, the runner path and its `runnerSha256`, the state the shop was left in); the classification and
**where the steps came from**; reproduction; verification; the regression net, ending with the
sentence `Regression coverage: smoke only.`; the honesty checks (scenario and runner hashes identical
across phases, preconditions, canary readings, bug assertions referencing PR-introduced markup, flake
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

* `scripts/run.js` — the phase runner, shipped with the skill. Invoked by path, never edited for a run, never copied into the run directory. Its hash lands in every `phase.json`.
* `references/runner.md` — how to stand up Playwright, how to locate and invoke the runner, what it writes, what a scenario is handed, the scenario template, and the checks that pass for the wrong reason.
* `references/prestashop.md` — back-office login and tokens, caches, builds, module `vendor/`, one-way migrations, and the PR-dependency probe.
