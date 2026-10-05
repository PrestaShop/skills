---
name: prestashop-pr-sandbox
description: Duplicates an upstream PrestaShop pull request onto a fork (personal or sandbox org) so AI review tools can review and comment on the copy without touching the public PR. Syncs the fork's base branches (develop, 9.2.x, 8.2.x) with upstream first, so the copy shows exactly the same diff. Use when the user says "duplicate PR #123 on my fork", "sandbox this PR", "copy these PRs for the review benchmark", "sync my fork's base branches", or prepares PRs for an AI review tool evaluation.
compatibility: Needs bash, git, jq, python3 and gh authenticated with write access to the target fork. Works for any PrestaShop repository (core, ps_apiresources, native modules) as long as a fork exists.
---

# Duplicate a PrestaShop PR onto a fork

Goal: every evaluator reviews the **same** reference PRs, each on their own fork, with no trace on the public repository (no bot comment, no backlink, no notification).

The copy is: a branch `sandbox/pr-<N>` on the fork at the PR's exact head commit, and a PR on the fork targeting the same base branch name as upstream (`develop`, `9.2.x`, ...), with the original title and description.

## Scripts

All in `scripts/`, run them rather than retyping the steps.

| Script | Does |
| --- | --- |
| `sync-bases.sh [--upstream O/R] [--fork O/R] [--dry-run] [branch...]` | Fast-forwards the fork's base branches to upstream, creates missing ones. Defaults to `develop 9.2.x 8.2.x` for the core. Never forces |
| `duplicate-pr.sh <pr> [--fork O/R] [--suffix S] [--pin-base] [--no-sync] [--repo-dir DIR] [--dry-run]` | Syncs the base branch, pushes the head, opens the fork PR, checks the diff matches upstream. Last line is a JSON summary |
| `defuse-body.py <O/R>` | Used by `duplicate-pr.sh`: rewrites the description so it pings nobody and links nothing upstream |

`<pr>` accepts a URL, `Owner/Repo#N` or a bare number (PrestaShop/PrestaShop). `--fork` defaults to `<gh user>/<repo>`; pass it for a sandbox organization.

## Workflow

1. **Collect** the PR list and the target fork. Several PRs: handle them one after the other.
2. **Dry-run first** for each PR: `duplicate-pr.sh <pr> --fork <fork> --dry-run`. Show the user the plan (base sync, branch, title) before writing anything on GitHub. Skip this when the user already said to go ahead.
3. **Run** without `--dry-run`. Exit codes:
   - `3`: the fork does not exist. Offer `gh repo fork <O/R> --clone=false` (or `--org <org>`), run it only once the user agrees.
   - `4`: the fork's base branch has its own commits (diverged). Do not reset it: ask the user, or use `--pin-base`.
   - `5`: the branch already exists at another commit. Use `--suffix`, or delete the branch with the user's consent.
   - `6`: the base already contains the PR (merged upstream): rerun with `--pin-base`.
4. **Check** `diff_match` in the JSON. `false` means the fork PR does not show the upstream diff (base out of date, or diverged); report it, it biases the evaluation.
5. **Report** a table: upstream PR, fork PR, base, `diff_match`. Remind the user that review tools only see the fork PR once the tool is installed on that fork.

## Choices to explain when they matter

- **Merged PRs**: their commits are already in the live base branch, so a copy against it is empty. `--pin-base` creates `sandbox-base/pr-<N>` at the PR's merge base and targets it instead. Some tools only review PRs targeting configured branches (CodeRabbit reviews the default branch unless `base_branches` is set): say so.
- **Pinned vs live base**: live base (default) is what the user asked for and what most tools review out of the box. Pinned base gives every evaluator the exact same code, whatever day they synced. Suggest `--pin-base` when evaluators sync at different times and whole-project context matters.
- **Stability runs**: `--suffix 2` makes a second, independent copy (`sandbox/pr-<N>-2`) to run the same tool twice.
- **Draft**: the copy is created ready for review; several tools skip drafts.

## Never

- Comment, review, label or push anything on the upstream PR or repository.
- Force-push or reset a fork branch without the user's explicit consent.
- Restore `@mentions` or upstream issue links in the copy: GitHub would notify the authors and add backlinks on the public issues.
