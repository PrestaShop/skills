# Writing the reports and the comment

Everything the skill produces once the two measurements exist: which file is for whom, what goes in each, and the rules for the text that gets pasted on GitHub. None of it changes a verdict, which is why it lives here rather than in `SKILL.md`.

## Contents

* The shape of `verdict.json`
* The two reports
* `report.md` layout
* What to post on GitHub

## The shape of `verdict.json`

The judgement, written once, by you. Both reports render it and neither adds to it.

```json
{
  "verdict": "approved | not-approved | not-reproducible | not-applicable",
  "caveat": "the one sentence that qualifies the verdict, or omit",
  "why": "one sentence of reasoning",
  "pr": { "repo": "owner/repo", "number": 1234, "title": "…" },
  "classification": "bugfix | feature",
  "stepsFrom": "where the test steps came from, in words",
  "environment": { "fo": "…", "bo": "…", "cwd": "…", "versions": "PrestaShop x, PHP y, and the version of whatever the PR is about: theme z, module w, library v" },
  "states": { "before": "merge base <sha>", "after": "PR head <sha>" },
  "canary": { "before": 0, "after": 1 },
  "notTested": ["…"],
  "comment": "the exact text to paste on GitHub, and nothing else",
  "attach": ["before/03-….png", "after/03-….png", "after/video.webm"]
}
```

Inside `environment`, write only the fields the run actually had. A browser run has `fo`, and `bo` when the PR touches it. An HTTP run has `fo`, the base URL it called. A command-line run has neither, it has `cwd`, the checkout the commands ran in. The report prints a row per field present and nothing for the rest, because an empty `Front office` line claims the field was measured and came back blank. `versions` is the one field every probe carries. The older name for this object was `shop`, and `report.js` still reads it, so a verdict written before the rename renders unchanged.

`versions` always carries the PrestaShop and PHP versions, **plus the version of the thing the pull request is about**: the theme for a theme PR, the module for a module PR, the package for a library. Leaving the module version out of a module QA is leaving out the one number a reviewer will check against the branch. Read it rather than assume it: `$this->version` in `[module].php` for a module, `config/theme.yml` for a theme, `composer show` for a library.

`comment` and `attach` are separate on purpose: what goes in the comment gets pasted, and a list of files to attach is an instruction to the person pasting, not something a pull request should carry.

## The two reports

`report.html` is the deliverable the developer reads: one page, the verdict first, the recording as evidence, the comment ready to copy. What the evidence looks like follows the probe: paired screenshots and a video for a browser run, paired transcripts for a command line or an endpoint. `scripts/report.js` renders it from `verdict.json` and the two `phase.json`, never by hand, so every run looks the same and the page cannot claim more than was measured. Its colours, type and layout are specified in the design reference listed in `SKILL.md`.

`report.md` is the same run written out as text: it greps, it diffs, and it survives being pasted into a tool that does not render HTML.

## `report.md` layout

In this order:

1. the verdict as the H1, with any caveat immediately under it
2. the environment: URLs, the PrestaShop and PHP versions, the version of the theme, module or library under test, the two states tested, the commands run in each phase and who ran them, the probe and what it needed (browser and Playwright versions, or the working directory, or the base URL), the runner path with its `runnerSha256`, and the state the environment was left in
3. the classification, and **where the test steps came from**
4. reproduction, then verification
5. the regression net: the smoke pass and, for a browser run, the two narrow viewports, each stated as introduced, pre-existing or fixed, ending with a sentence naming exactly what was covered, for example `Regression coverage: smoke pages, plus 375/768 responds-renders-no-overflow only.`
6. the honesty checks: the three hashes identical across phases, preconditions, canary readings, bug assertions referencing PR-introduced markup, flake re-samples
7. what was not tested
8. the verdict and one sentence of reasoning
9. a pointer to `comments/`, and the artifact tree

Reference screenshots paired by step index, so a reviewer sees both states of the same moment:

| # | Step | before | after |
| --- | --- | --- | --- |
| 03 | observe the symptom | `before/03-observe-the-symptom.png` | `after/03-observe-the-symptom.png` |
| n/a | front page at 375 | `before/mobile-home.png` | `after/mobile-home.png` |
| n/a | front page at 768 | `before/tablet-home.png` | `after/tablet-home.png` |

Write it flat: no emoji outside the severity markers, no first person, no hedging, no praise, no restating the diff.

**No em dashes anywhere you write prose**, in `report.md`, in `verdict.json` or in `comments/`. Use a full stop, a colon, or brackets. A dash-spliced sentence is the single strongest tell that a machine wrote the text, and the one place it would be seen is the comment posted on the pull request.

## What to post on GitHub

`report.md` is for the person who ran the QA, not for GitHub: it is too long, it carries local paths, and a fenced block inside it has to be hand-selected before it can be pasted. Write the GitHub text as its own files, one per target, named `[owner]-[repo]-[number].md`:

```text
comments/
├── index.md                          # what to post where, and in what order
└── PrestaShop-hummingbird-1092.md    # paste this, whole, into that PR
```

Rules for a file in `comments/`:

* **Its entire content is the comment.** No surrounding fence, no report headings, nothing to trim: `pbcopy < comments/[file].md` then paste. Tell the user that command.
* First line is the verdict. Second line says where the review came from, and it names the probe, because a comment claiming a browser on a command-line run is a small lie that costs the whole report its credibility:

  * browser: `_AI-assisted QA: an agent drove a real browser through the steps below and drafted this comment. Worth a sanity check._`
  * command line: `_AI-assisted QA: an agent ran the commands below and drafted this comment. Worth a sanity check._`
  * HTTP: `_AI-assisted QA: an agent made the requests below and drafted this comment. Worth a sanity check._`

  `scripts/report.js` checks this one: if the comment claims a browser on a command-line run, or the reverse, it refuses to render and says so. It is the only sentence in the comment a machine can verify, and it is the one that would be read as a fact.

  **Assisted**, not automated: a person chose the pull request, answered at every gate, put the environment in each state and is pasting this. The agent measured and drafted. Saying "automated" would credit the machine with a judgement nobody supervised, and posting an approval without saying a machine drafted it misleads the people who act on it. Say it once, plainly, and never apologise for it in the text.
* **Nothing in the file addresses the person pasting it.** No "attach by hand", no "copy this", no note about the tooling. Everything in that file is read by the pull request's audience, and an instruction meant for one reader is noise for all the others, or worse, gets pasted and stays.
* No absolute paths, **no run-directory paths**, no credentials. The reader cannot see your disk. A screenshot is referred to by what it shows, never by its filename.
* At most about 15 lines. The detail stays in `report.md`.
* `index.md` is the file nobody pastes, so everything the person doing the pasting needs goes there: each comment file with its target URL, one line on why it is being posted, and **the list of screenshots and videos to attach by hand**, because images and video cannot be uploaded programmatically. One line long for a single target, which is fine: it is how they know they are done.

Write a second file **only** when the verdict genuinely covers another repository, such as a theme PR that needed a core PR applied alongside it, say. Then each comment is written for its own readers, and both state that the result covers the combination rather than either PR alone.

