# Reading the checklist

The checklist decides what a campaign answers for. This skill reads it and adds nothing.

## Where it comes from

`docs/qa/testing-checklist.md`, in the Hummingbird repository and nowhere else. The skill never
carries a copy: a copy would be wrong the first time the theme changed, which is the one thing
the checklist is built not to be.

**Take it from the release tag matching the theme version.** Two people testing the same release
then read the same checklist, and a campaign resumed months later reads it again unchanged.
`checklist.js` asks for `refs/tags/v<version>`, the tag itself rather than any ref with that name,
so a branch called `v2.1.0` can never be labelled a release. One spelling only: every Hummingbird
release is tagged `vX.Y.Z`. It falls back to the working copy when that tag does not carry the
file, and says so. The report says which of the two it used, on its front page,
because a checklist from a moving branch is a weaker basis than one from a tag.

## What counts as a test

Two kinds of line:

* every `- [ ]` tick box
* rows in the tables that list things to test

A table is a list of tests when its **first column heading** says so: `Module`, `Setting`,
`BO tab`. Everything else, product types, profiles, breakpoints, the severity table, the list of
sources the checklist is derived from, is reference material. `checklist.js` prints its decision
for every table it meets, with the heading that decided it, so a wrong call is visible instead of
silently adding or dropping tests.

## Points that change a shop setting

The checklist marks them, and it does so in two ways. Some points carry `(config)` themselves.
Some sections say it once in their own prose, either "everything in this section is (config)" or,
as in the multishipment section, by turning a feature flag on for the whole section. Both are
picked up, and a section that declares it passes it down to its subsections, which is where the
points actually live.

Over-marking a point costs one reading of a setting. Under-marking it leaves the shop altered for
every section that follows, so the reading errs towards marking, and prints the line that decided
it.

## How a point is named

`3.2/07` is the seventh testable line of section 3.2. That name is convenient and, on its own,
a trap: add one line at the top of a section and every number below it shifts, quietly attaching
yesterday's results to the wrong test.

So a point is identified by **its text as well as its position**. `checklist.json` carries a hash
of each point's text, and comparing two revisions matches on that first:

```bash
node "$SKILL_DIR/scripts/checklist.js" --diff old.json new.json
```

It reports additions, removals and moves, naming both the old and the new number for every move.
Read the moves before reusing anything written against the older revision.

## Staying in step with the theme

The theme's own `CONTEXT.md` binds the checklist to the code: change the hook assignments in
`config/theme.yml`, add or remove a module override, add a page or a partial, or change the
breakpoints, and the checklist changes in the same pull request.

So this skill never needs updating when the theme grows a page or a module. What it does need is
for the campaign to read the checklist belonging to the version under test, which is why the tag
matters. If a checklist point turns out to be wrong, that is a correction to propose against the
theme repository, not a finding against the theme: answer that point `inconclusive` with the
reason, list it under `checklistCorrections`, and open no ticket. The full rule is in
[reporting.md](reporting.md).
