---
name: hummingbird-theme-qa
description: Runs a full end-to-end test campaign on the Hummingbird theme against a given PrestaShop version, driven by the theme's own testing checklist, and writes a report of what it found with the screenshots that prove it. Use when the user says "test Hummingbird", "run the theme QA", "full test pass on the theme", "check Hummingbird on PrestaShop 9.2", "run the QA checklist", or asks whether the theme is sound enough to release. For QA scoped to one pull request, use the prestashop-pr-qa skill instead.
compatibility: Needs a running PrestaShop shop serving Hummingbird, a Hummingbird checkout, an agent with shell access, node and git. A browser campaign also needs npm and Playwright, installed on first use into a temporary folder outside the shop. Reading the shop settings needs a read-only command that reaches its database, which you supply. Docker is optional and only saves asking which folders the shop serves.
---

# Test the Hummingbird theme end to end

The theme ships its own checklist at `docs/qa/testing-checklist.md`. **That file decides what
gets tested, and it is the only thing that does.** This skill reads it, walks the shop in a real
browser, and hands back one report saying what was checked, what was found, and what nobody
looked at.

Two things make the report worth reading, and both are enforced by the tooling rather than by
good intentions:

* **Nothing passes by default.** A checklist point is green only if a check looked at it and
  recorded what it looked for.
* **Every green points at a file.** Either the check named one, or it ran inside a step and the
  screenshot of that step stands for it. `report.js` refuses to build a report with a green that
  has neither, and a screenshot that could not be taken is a fault on the run rather than a
  silence. This is why **every check belongs inside a `step()`**: the step is what photographs it.
* **A campaign can be driven to the end without a person reading the report each time.** Every
  build writes `gaps.json`, the points still owed an answer, and `--require-complete` refuses to
  build at all while that list is not empty.

## Words this skill uses

Say the right column out loud. Never make the person you are talking to learn the left one.

| Term | What it means |
| --- | --- |
| campaign | one test pass on one pair of versions, theme and PrestaShop, built up over one or more sittings |
| section | one numbered part of the checklist, such as 3.2 Category and listings |
| point | one line of the checklist, addressed as `3.2/07` |
| cell | one combination of customer type and screen width, such as B2B at 375 |
| finding | something that was found. It carries what kind, whether it is new, and how bad |
| fingerprint | a reading of the shop's settings, taken to tell that the shop has not moved |

## Who you are talking to

They know the theme and the shop. They do not know this skill and should not have to.

* **Every question is one thing, with one reason.** Print the command, say in a sentence what it
  is for, wait.
* **Never guess an address or a version.** The shop URL, the back office URL, the admin folder
  and the theme folder are asked for. Versions are read from `config/theme.yml`, `docker/.env`
  and `composer show`. A guessed URL answers 404, which reads exactly like a broken page, and a
  wrong red costs more than an admitted gap.
* **Say what was measured, not what is likely.** If nobody looked at something, the report says
  so. That is the sentence that makes the rest believable.

## Rules that do not bend

1. **The checklist is the scope.** Add no test, drop no section, invent nothing. The only
   judgement is how to measure a point and whether a machine can settle it at all.
2. **Take the checklist from the release tag** matching the theme version, whenever one carries
   it. Fall back to the branch only when none does, and say so on the report.
3. **The developer owns `git`.** Print the command and wait. Everything downstream of a
   checkout, the build, `composer install`, `cache:clear`, this skill offers to run.
4. **Evidence never lands in the theme folder or anywhere the shop serves.** `pick-run-dir.sh`
   enforces it and refuses a folder that would.
5. **Look for the back office credentials before asking for them.** A shop run from a
   compose file usually declares them, and the defaults are right there:
   `grep -E 'ADMIN_MAIL|ADMIN_PASSWD' docker-compose*.y*ml .env`. Read what the compose
   file sets, check `.env` does not override it, and try them. Asking for something the
   repository already states costs the person a round trip and can strand a whole sitting.
6. **Credentials arrive in the environment**, never as arguments: `QA_BO_EMAIL` and
   `QA_BO_PASSWORD` for the back office, `QA_SQL` for the command that reads the database.
   Arguments are readable by everyone on the machine and end up in files that get shared.
7. **Nothing is posted anywhere.** Issue text is written to files for the user to paste.
8. **A shop-wide setting is written down before it is changed**, and a restore nobody could
   confirm counts as a failure.
9. **Data made up for a test is written down before it is made**, and ends either removed and
   read back, or left on purpose with the reason. A record that is neither stops the report from
   building, because the alternative is a shop quietly carrying invented data that the next
   campaign reads as real.

## What to ask for

* the front office address of the running shop, and the back office address with its admin
  folder name, which differs on every installation
* the Hummingbird folder to read the checklist from
* a read-only command that reaches the shop database, for the settings reading. It runs as
  given, so nothing here assumes Flashlight, the official image, or any container name. Ask for it
  once and put it in `QA_SQL`, because it carries a password and an argument does not stay private
* whether the whole checklist is wanted, which is the default, or a narrower set of sections

Do not ask for anywhere to put files: `pick-run-dir.sh` works that out and refuses a bad one.

## Workflow

Copy this into your reply and tick it off:

```
Campaign progress:
- [ ] 1. Set up the campaign folder and the browser tooling
- [ ] 2. Read the shop, the checklist and the settings baseline
- [ ] 3. Agree the run
- [ ] 4. Run it, section by section, until gaps.json is empty
- [ ] 5. Sort the new problems from the old ones
- [ ] 6. Write campaign.json, build the report, write the issue files, offer the link
```

### 1. Set up the campaign folder

Nothing is written anywhere until this has answered, because the next step reads the shop settings
into a file that carries the merchant's email address. `SKILL_DIR` is the folder this file was
read from.

```bash
RUN=$(sh "$SKILL_DIR/scripts/pick-run-dir.sh" "[front office URL]" \
        "$HOME/hummingbird-theme-qa/[theme version]-ps[PrestaShop version]-[date]" \
        "[the Hummingbird folder]") || exit 1

NODE_PATH=$(sh "$SKILL_DIR/scripts/playwright-lab.sh") || exit 1; export NODE_PATH
```

Keep the `|| exit 1`. Without it a refusal leaves `$RUN` empty and the campaign writes into
`/suites`.

The Hummingbird folder goes in as a third argument on purpose: that is what makes rule 4 true in
every setup rather than only when the shop happens to run from the theme's own compose file.

If it refuses, read what it printed. It refuses a folder inside the theme checkout, inside
anything the shop serves, and any path holding a value that was never filled in. Tell the user
where the campaign folder is now, and again at the end.

### 2. Read the shop, the checklist and the settings baseline

```bash
node "$SKILL_DIR/scripts/checklist.js" --theme="[the Hummingbird folder]" --out="$RUN/checklist.json"
```

It says where it took the checklist from, prints its decision about every table, and counts the
points. Show that count to the user: it is the size of what they just agreed to.

Read the versions rather than asking: `version` and `compatibility` in `config/theme.yml`, the
PrestaShop version from the shop, module versions from `composer show`. **Stop** if the theme
under test falls outside the PrestaShop range it declares: every result would be about a
combination nobody supports.

Then take the settings baseline, which is what later tells you the shop has not moved:

```bash
export QA_SQL='[the read-only command]'
node "$SKILL_DIR/scripts/fingerprint.js" --out="$RUN/baseline/settings.json"
```

**`QA_SQL` has to be exported in every shell that reads the shop**, including the drift check in
step 4: each command you run starts a fresh one, and an unset `QA_SQL` makes `fingerprint.js`
print its usage and exit without ever reaching the database, which is a check that looks like it
passed and never ran.

**The command goes in the environment, never in an argument.** An argument is readable by every
other user on the machine and is printed into the transcript, and this one carries the database
password. `--sql=` stays for a command that carries no secret.

`$RUN/baseline/settings.json` holds the merchant's email address and can hold credentials. It stays
in the campaign folder and never goes into a published report.

### 3. Agree the run

Propose the whole checklist. Say which parts will need them rather than the browser, and roughly
what that costs. They may narrow it, and then the report says a narrowed run is what happened.

### 4. Run it, section by section

Write one suite per section from the checklist points, following
[references/suites.md](references/suites.md), which carries the template, everything a suite is
handed, and the list of checks that pass for the wrong reason. Then, for each cell:

```bash
node "$SKILL_DIR/scripts/run-suite.js" \
  --suite="$RUN/suites/[section]/suite.js" --out="$RUN/suites/[section]" --label=pass \
  --url="[front office]" --bo-url="[back office]" \
  --profile=b2c --viewport=desktop --checklist-sha="[the sha256 from $RUN/checklist.json]"
```

Run **profile by profile, not section by section**: B2B mode is a shop-wide switch, so every B2C
cell runs, the switch is flipped once, then every B2B cell. A campaign that flips it per section
strands the shop on the first crash.

**`--profile` is a label, not a switch.** Nothing in the tooling makes the shop B2B
because a run says `--profile=b2b`. Throw the switch, then **prove it on the front
office before running anything**: a category page answering 200, the header rendering
its modules, and a price that changed. A customer group created without category and
module access is the trap here, because PrestaShop grants both per group: every
category answers 403 and the header comes out empty, which is indistinguishable from
the theme collapsing. One pass of that produced seventeen failures that were all the
group's permissions and none of them the theme's.

**Some points cannot be answered on the data the shop has**, and the campaign may make up what
they need: a linked accessory, without which the accessories block does not render at all, an
order so cross-selling and best sellers have history, a cart rule for the vouchers page. Look
first: a demo install already carries most of it, and creating a twenty-first product to test a
listing buys nothing and changes the shop for every section after it. Make it through the back
office or the front office, never by writing to the database, or the theme will look broken when
it is not. The rules and the calls are in [references/environment.md](references/environment.md).

A result that came from a command or from a person goes through the same door, and carries the
file that shows it. Put that file in the cell folder first:

```bash
mkdir -p "$RUN/suites/1/pass/b2c-desktop"
npm run lint > "$RUN/suites/1/pass/b2c-desktop/lint.txt" 2>&1

node "$SKILL_DIR/scripts/observe.js" --out="$RUN/suites/1" --item=1.1/02 --outcome=pass \
  --by=command --assertion='the linters and Prettier both finished clean' \
  --evidence=lint.txt --checklist-sha="[the sha256 from $RUN/checklist.json]"
```

A browser check leans on the screenshot of its step. Nothing photographed this one, so it names
its own proof, and `observe.js` refuses a pass without one.

**Answering the whole checklist, without a person driving each turn.** After each section, build
the report and read `gaps.json`: it lists every point still owed an answer and, for a partly
covered one, which cells are missing. Write the suites it names, run them, build again, until it
is empty. Then build with `--require-complete`, which refuses while anything in scope is still
unanswered, so a campaign cannot quietly finish half done.

```bash
node "$SKILL_DIR/scripts/report.js" --campaign="$RUN" >/dev/null
node -e 'const g=require(process.argv[1]);console.log(g.notCovered.length+g.partlyCovered.length+" still owed");
         for (const x of [...g.notCovered,...g.partlyCovered].slice(0,20)) console.log(" ",x.item,x.text.slice(0,70))' \
  "$RUN/gaps.json"
```

Before starting each new section, read the settings again and compare. If they moved and nothing
in the journal explains it, stop: results either side are not about the same shop.

```bash
export QA_SQL='[the same read-only command]'
node "$SKILL_DIR/scripts/fingerprint.js" --compare="$RUN/baseline/settings.json"
```

### 5. Sort the new problems from the old ones

Only for the points that turned up something. See [references/reporting.md](references/reporting.md).

### 6. Write the report

Write `campaign.json` yourself: it carries what was tested and what was found, and it is the one
place a judgement is written. Its shape is in [references/reporting.md](references/reporting.md).

```bash
node "$SKILL_DIR/scripts/report.js" --campaign="$RUN" --artifact=report-artifact.html --require-complete
```

It refuses to build if any claim is unbacked, if a green has no file behind it, if a run answered
a different revision of the checklist, or, with `--require-complete`, while anything in scope is
still unanswered. Fix what it names rather than passing `--no-verify`, which exists only to look
at a report you already know is not trustworthy. Drop `--require-complete` only for a campaign
that was deliberately narrowed, and then say so in `scope`.

Then write one issue file per finding, for the repository that owns it, into `$RUN/issues/`, with
an `index.md` saying what to open where. The rules for what goes in them, and what never does, are
in [references/reporting.md](references/reporting.md). **Nothing is posted anywhere**: give the
user the files and the command to copy one.

Then offer to publish `report-artifact.html` as an Artifact so it has a link that can be shared.
**Look at every screenshot in it first.** A back office puts email addresses in order pages and a
login form carries the admin address. Anything that should not travel is retaken with the field
out of frame, or covered with a solid box, never blurred. Publishing is offered, never done
without being asked.

## How findings are labelled

Three labels. The report shows the checklist's own words on top of them.

| Label | Values |
| --- | --- |
| what kind | `functional`, `visual`, `accessibility`, `content`, `performance` |
| is it new | `regression`, `pre-existing`, `never-implemented`, `unknown` |
| how bad | `blocker`, `major`, `minor` |

* **blocker**: you cannot buy. A step of catalogue, product, cart, checkout, confirmation is
  impossible, a page errors out or renders unstyled, or a price, tax or total is wrong.
* **major**: you can still buy, but something documented does not work at all, or the layout
  hides a control at one width.
* **minor**: it works and it looks wrong.

Kind never caps how bad it is: a visual defect that hides Add to cart is a blocker. Whether it is
new never changes how bad it is, but it does drive the recommendation.

The checklist's sixth kind, **Checklist**, is not a defect of the theme. It means the point being
tested was itself wrong: it describes a tab, a setting or a hook that no longer exists. Record it
like this, and the point stays out of both the green count and the findings count:

* the answer is `inconclusive`, with the reason naming what is wrong with the point. Not `pass`,
  because nothing about the theme was settled, and not `fail`, because the theme did nothing
  wrong
* add an entry to `checklistCorrections` in `campaign.json`, which the report prints as its own
  section
* **no finding**, and no ticket. The fix is a line in `docs/qa/testing-checklist.md`, in the same
  repository as the theme

The count of findings is what a release decision is made on. Three blockers of which one is a
stale checklist line is not "nearly three": it is a number nobody can use.

## Troubleshooting

| What you see | What it means | What to do |
| --- | --- | --- |
| `refusing: ... is inside ...` | the campaign folder would be committed or served | pick one under `$HOME` |
| `refusing: ... has an 'undefined' segment` | a value was never filled in | build the path again with the real version and date |
| `refusing: nothing publishes port N` | the shop is not in Docker, so what it serves cannot be found | pass the folder the web server serves as a third argument |
| `node is not on PATH` | node comes from nvm or asdf, which a non-interactive shell does not load | run from a shell where `node -v` works |
| `refusing to build the report` | a claim has no evidence behind it | fix what it names; that message is the skill working |
| `is recorded as passing with nothing to show for it` | a check ran outside any `step()`, so nothing photographed it | move it inside a step, or name a file with `--evidence` |
| `left no screenshot` in the faults | the browser could not photograph a step | the folder may be read-only or the page never settled. Every green in that run is now unproven, so fix it and run the section again |
| `this run answered a different revision of the checklist` | the checklist moved under a half-finished campaign | run `checklist.js --diff` to see what moved, then re-run the sections it touched |
| `two shops share this database` | two prefixes, each with a full shop behind it | point the command at one database, or pass `--prefix=ps_` |
| `never said which revision of the checklist it answered` | a run was made without `--checklist-sha` | pass it, and re-run that cell |
| `point(s) in scope are not answered on every cell yet` | `--require-complete` and `gaps.json` is not empty | answer what it names, or drop the flag and declare the narrowed `scope` |
| `THE SHOP HAS MOVED` | a setting changed since the baseline | put it back, or start a clean shop, and say in the report that a reset happened |
| a module check says "renders nothing" | it is installed and its assets load but it shows nothing | read its configuration: an empty one is a state the checklist asks about, a dead hook is a defect |
| a module check says its markup "is not really visible" | the module rendered, but something is covering it | open the drawer or the accordion first, which is the narrow-screen check the checklist is asking for |
| a whole profile fails at once, every category 403 | the customer group that profile uses has no category or module access | PrestaShop grants both per group: copy them from the default customer group before blaming the theme |
| every mobile control reads "hidden by a parent" | they live in a drawer that starts closed | open the drawer first, which is the mobile check the checklist actually asks for |

## Bundled files

| File | What is in it |
| --- | --- |
| [references/environment.md](references/environment.md) | the shop, versions, builds, caches, and the settings reading |
| [references/checklist.md](references/checklist.md) | how the checklist is read, how points are named, staying in step |
| [references/suites.md](references/suites.md) | the suite template, everything a suite is handed, what a machine may and may not settle |
| [references/reporting.md](references/reporting.md) | `campaign.json`, findings, telling new from old, the report and the issue files |
| [references/design.md](references/design.md) | how the report looks, and why |
| `scripts/checklist.js` | reads the checklist, and compares two revisions of it |
| `scripts/pick-run-dir.sh` | picks the campaign folder, refuses one that would leak evidence |
| `scripts/playwright-lab.sh` | installs the browser tooling outside the shop |
| `scripts/fingerprint.js` | reads and hashes the shop settings |
| `scripts/record.js` | the rules every run shares. Never edited for a campaign |
| `scripts/run-suite.js` | runs one section in a browser |
| `scripts/observe.js` | records an answer that came from a command or from a person |
| `scripts/report.js` | builds the report and `gaps.json`, and refuses to build an unproven claim |
