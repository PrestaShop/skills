---
name: prestashop-issue-sandbox
description: Duplicates an upstream PrestaShop issue onto a fork (personal or sandbox org) so AI tools can triage it, comment on it or open a fix PR without touching the public issue. Copies the label set the tool can choose from but not the issue's own labels, which stay the triage reference. Can freeze a base branch before the fix when the issue is already fixed upstream. Use when the user says "duplicate issue #123 on my fork", "sandbox this issue", "copy these issues for the triage benchmark", or prepares issues for an AI triage evaluation.
compatibility: Needs bash, jq, python3 and gh authenticated with write access to the target fork. Works for any PrestaShop repository as long as a fork exists.
---

# Duplicate a PrestaShop issue onto a fork

Goal: every evaluator triages the **same** reference issues, each on their own fork, with no trace on the public repository (no bot comment, no backlink, no notification), and the tool cannot read the answer.

The copy is an issue on the fork with the original title and description. It gets **no labels**: the upstream labels (type, severity, category) are the reference the triage is scored against, and they are printed in the JSON summary instead.

## Scripts

All in `scripts/`; run them rather than retyping the steps.

| Script | Does |
| --- | --- |
| `duplicate-issue.sh <issue> [--fork O/R] [--suffix S] [--enable-issues] [--no-labels] [--reporter-comments] [--pin-before-fix] [--dry-run]` | Turns issues on (when asked), copies the upstream label set, optionally freezes a base before the fix, opens the fork issue. Last line is a JSON summary |
| `defuse-body.py <O/R>` | Rewrites the description so it pings nobody and links nothing upstream |

`<issue>` accepts a URL, `Owner/Repo#N` or a bare number (PrestaShop/PrestaShop). `--fork` defaults to `<gh user>/<repo>`; pass it for a sandbox organization.

## Workflow

1. **Collect** the issue list and the target fork. Several issues: handle them one after the other.
2. **Dry-run first** for each issue: `duplicate-issue.sh <issue> --fork <fork> --dry-run`. Show the user the plan before writing anything on GitHub. Skip this when the user already said to go ahead.
3. **Run** without `--dry-run`. Exit codes:
   - `3`: the fork does not exist. Offer `gh repo fork <O/R> --clone=false` (or `--org <org>`); run it only once the user agrees.
   - `7`: issues are off on the fork (the GitHub default for forks). Ask the user, then rerun with `--enable-issues`.
   - `8`: `--pin-before-fix` was asked but no merged PR closes the issue. Ask the user which commit to freeze, or drop the option.
   - `5`: the frozen base branch exists at another commit. Delete it with the user's consent, or use `--suffix`.
4. **Report** a table: upstream issue, fork issue, upstream labels (the triage reference), fix PRs, frozen base. Keep the upstream labels out of anything the tool can read.

## Choices to explain when they matter

- **Already fixed upstream**: the script warns when a merged PR closes the issue. The fork's base branches then contain the fix, so a tool asked to fix the issue may find nothing to change. `--pin-before-fix` creates `sandbox-base/issue-<N>` at the fix PR's merge base. For the "PR from issue" test, either make that branch the fork's default branch or tell the tool to target it (it is the evaluator's call: changing the default branch affects every tool on that fork). The fix PR itself is the reference for scoring the fix.
- **Labels**: the full upstream label set is copied once (existing fork labels are kept), so a tool can only pick real PrestaShop labels. `--no-labels` skips it.
- **Reporter comments**: `--reporter-comments` appends what the reporter added before anyone else answered. Later comments contain the maintainers' triage and are never copied.
- **Stability runs**: `--suffix 2` makes a second, independent copy of the same issue.
- **Attachments**: images and videos stay linked to their upstream URLs (`user-attachments`), which are public.

## Never

- Comment, label or edit anything on the upstream issue or repository.
- Put the upstream labels, milestone, assignees or maintainer comments on the copy.
- Restore `@mentions` or upstream issue links in the copy: GitHub would notify the people and add backlinks on the public issues.
- Enable issues, create a fork or force a branch without the user's explicit consent.
