# The findings, the report and the issue files

Everything that happens once the runs exist. None of it changes what was measured.

## Contents

* `campaign.json`
* How a finding is written
* Telling a new problem from an old one
* What the report shows
* The issue files
* Publishing

## `campaign.json`

The one place a judgement is written. You write it; `report.js` renders it and adds nothing.

```json
{
  "campaign": "one sentence: what was tested, on what, and when",
  "shop": {
    "front": "the front office address",
    "back": "the back office address",
    "prestashop": "the version, read not assumed",
    "install": "how it runs, in words"
  },
  "theme": { "version": "2.1.0", "ref": "v2.1.0", "commit": "..." },
  "matrix": { "profiles": ["b2c", "b2b"], "viewports": ["desktop", "mobile"] },
  "scope": { "sections": ["2", "3.2"], "why": "why it was narrowed, or omit the whole object for the full checklist" },
  "findings": [],
  "checklistCorrections": [],
  "notTested": ["anything a reader would otherwise assume was covered"]
}
```

Leave `scope` out when the whole checklist ran. When it is there, the report says on its front
page that this was not the whole checklist, and how many points were left out. That sentence is
the difference between a partial campaign and a misleading one.

## How a finding is written

```json
{
  "id": "F-1",
  "title": "one line, what a person sees",
  "items": ["3.2/07"],
  "kind": "functional | visual | accessibility | content | performance",
  "history": "regression | pre-existing | never-implemented | unknown",
  "severity": "blocker | major | minor",
  "severityReason": "the clause that was matched",
  "layer": "theme | module | core",
  "repo": "PrestaShop/hummingbird",
  "where": { "page": "Category", "url": "...", "profile": "b2c", "viewport": "mobile" },
  "steps": ["from a clean cart and session, ..."],
  "expected": "...",
  "actual": "...",
  "evidence": ["suites/3.2/pass/b2c-mobile/04-the-listing.png"],
  "occurrences": [{ "cell": "b2c/mobile", "evidence": "..." }]
}
```

Three labels rather than one, because the checklist's own list mixes two questions: what sort of
defect it is, and how long it has been there. A visual defect is also either new or old, so one
column forces a wrong choice and two people make it differently. The report prints the
checklist's words back, derived: regression, bug, gap.

**Severity, first match wins**, and `severityReason` names the clause:

* **blocker**: a step of catalogue, product, cart, checkout, confirmation is impossible on any
  cell; a page answers 5xx or shows an error page; a page renders nothing or renders unstyled; a
  price, tax, shipping cost, total or stock figure is wrong; a level A accessibility failure that
  makes buying impossible by keyboard or assistive technology.
* **major**: the shopper can still buy, but something documented does not work at all on at least
  one cell, or breakage hides content or puts a control out of reach at a matrix width, or a
  level A accessibility failure away from the purchase path.
* **minor**: anything else that is still a defect.

Kind never caps severity. Whether it is new never changes severity, but the release decision
counts regressions against the release and lists what was already broken separately.

**One finding, several sightings.** The same problem is hit by several sections on several cells.
Give it one entry with `occurrences`, or the counts mean nothing.

**The theme is a presentation layer.** Business logic belongs to `PrestaShop/PrestaShop`, and a
module's own markup to that module's repository. A finding routed elsewhere is still reported
here; it is simply not the theme's to fix.

**The checklist's sixth kind is not a finding.** If the point being tested was itself wrong, the
theme did nothing and there is nothing to fix in it. Record it in three parts:

1. The answer to that point is **`inconclusive`**, with the reason naming what is wrong with it.
   Not `pass`: nothing about the theme was settled. Not `fail`: the theme did nothing wrong. It
   comes out in the report as not settled, with the explanation attached.
2. An entry in `checklistCorrections`, which the report prints as its own section so the
   correction does not get lost in a note.
3. **No finding, and no ticket.** The fix is a line in `docs/qa/testing-checklist.md`, in the same
   repository as the theme. A ticket saying "this test fails" would send someone hunting a bug
   that does not exist.

```json
"checklistCorrections": [
  {
    "item": "3.4/03",
    "problem": "the back office tab it names was renamed, so the row describes a tab that is not there",
    "proposed": "what the line should say instead"
  }
]
```

The findings count is what a release decision rests on. Counting stale checklist lines in it makes
the theme look worse than it is, and makes the number worth nothing, which costs more than the
one line it saved.

## Telling a new problem from an old one

Only for the points that turned up something, and the same suite file runs, so the comparison is
between two versions of the theme and nothing else.

Take the older theme from its release tag, so "the previous version" is a fixed thing anyone can
check out again.

**The versions do not always allow a clean comparison.** Each theme release declares the
PrestaShop versions it supports, and consecutive releases often do not overlap, so the older
theme may not run on the PrestaShop under test at all. Read both declared ranges rather than
assuming, and there are three honest outcomes:

| Situation | What the report says |
| --- | --- |
| the older theme supports this PrestaShop version | a clean comparison, one thing changed |
| it does not, and a second shop is brought up on the older theme's own PrestaShop | an indicative comparison, two things changed |
| no second shop | the question was not settled. `history` stays `unknown`, never `regression` |

Two guards, because this is the one output someone will act on:

* **Check the older theme's stylesheet actually built** before comparing anything. A build that
  failed quietly gives an unstyled shop, where every visual problem looks like it was always
  there.
* **If the older run was messy for any other reason**, the answer is "could not tell", not "old
  bug". A `pre-existing` from a dirty run is exactly how a regression gets waved through.

A problem that only appears in the older run is not a finding of this campaign: the older version
is not under test. Note it on that run and leave it there.

## What the report shows

Built by `report.js` from `campaign.json` and every `run.json`, in this order:

1. **The campaign**: versions, addresses, how the shop runs, the matrix, and where the checklist
   came from. A checklist read from a branch rather than a release tag is said here.
2. **Three numbers, not one score**: settled by a check, waiting for a person, not covered. Plus
   how many are only partly covered, and how many things were found.
3. **What was found**, worst first, with the evidence.
4. **Checklist corrections to propose**: points that turned out to describe something that is no
   longer true. Deliberately not counted as findings.
5. **Proof of test**: one line per checklist point, what was actually checked, on how many cells,
   who says so, and how many files back it up. This is the section the report exists for.
6. **Shop settings**, and whether anything was left changed.
7. **What went wrong in the runs themselves**: the faults, which are failures of the testing and
   not of the theme. A missing screenshot lands here, and anything a faulted run answered is worth
   reading twice.
8. **What was not tested**, and why.

`report.js` **refuses to build** when:

* a point is recorded as passing without saying what was checked
* a point is recorded as passing with nothing to show for it: no file named, and no screenshot of
  the step it ran in. That is the guarantee the front page makes, so it is a refusal rather than a
  footnote
* a cited file is not on disk
* an answer or a proposed correction names a point that is not in this checklist
* a run answered a different revision of the checklist than the one in `checklist.json`
* a setting was changed and never confirmed back
* `--require-complete` was asked for and `gaps.json` is not empty

Fix what it names. `--no-verify` exists only to look at a report you already know is not
trustworthy.

## Driving a campaign to the end

Every build writes `gaps.json` next to the report: the points with no answer at all, the ones
answered on some cells and not others, and the ones waiting for a person, each with the files to
look at. It is there so a campaign can run itself to the end, one section at a time, without a
person reading the whole report between turns:

1. run a section, build the report
2. read `gaps.json`
3. write and run the suites it names
4. repeat until nothing is owed
5. build once more with `--require-complete`, which refuses while anything in scope is unanswered

A campaign that was deliberately narrowed drops the flag and declares `scope` instead, and the
report says on its front page that this was not the whole checklist.

## The issue files

One file per finding, written for the repository that owns it, in `issues/`, plus an `index.md`
grouped by repository saying what to open where.

Write them in step 6, after the report builds, into `$RUN/issues/`.

* **The whole file is the issue.** No surrounding fence, nothing to trim.
* **Nothing in it addresses the person pasting it.** No "attach this by hand".
* **No paths from this machine**, no credentials. A screenshot is referred to by what it shows.
* Say once, plainly, that a machine drove the test and drafted the text, and that a person chose
  the campaign, answered the questions and is posting it.
* **Nothing is posted.** Tell the user the `pbcopy` command and where the files are.

## Publishing

`--artifact=report-artifact.html` writes a second copy of the report with its pictures carried
inside it, because a published page cannot reach files on this machine. A picture carried inside a
page is a third larger than the file on disk, and the page is capped at 16 MB once published, so
the budget is counted on what the page will weigh. When screenshots do not fit, the page says how
many were left behind rather than dropping them quietly. A recording is not carried at all: it is
shown as a player in the report you open locally, and named in the published one.

Publishing sends the page and every picture in it off the machine, so **look at all of them
first**. A back office puts email addresses on order pages, and a login form carries the admin
address. Retake anything that should not travel with the field out of frame, or cover it with a
solid box: never a blur, which over a short string in a known font is partly recoverable. Offer
the link; do not publish unasked.
