# AI review prompts

Shared review prompts for the AI review tools evaluation ([PrestaShop/PrestaShop#42950](https://github.com/PrestaShop/PrestaShop/issues/42950)). Every tool gets the same prompt for a given repository, so the results can be compared.

| Prompt | Repository | Guidelines it reads first |
| --- | --- | --- |
| [`core.md`](core.md) | PrestaShop/PrestaShop | `.ai/CONTEXT.md`, `.ai/GOTCHAS.md`, the domain and component contexts the PR touches |
| [`module.md`](module.md) | native modules | none in the repo: generic module rules in the prompt, plus ps_facetedsearch and productcomments sections |
| [`theme.md`](theme.md) | themes, starting with Hummingbird | `CONTEXT.md`, `PRODUCT.md`, `CONTRIBUTING.md` |
| [ps_apiresources](https://github.com/PrestaShop/ps_apiresources/blob/dev/.claude/REVIEW_PROMPT.md) | PrestaShop/ps_apiresources | `CONTEXT.md` (prompt kept in that repository) |

## Format

These prompts ask for an actual review, not a pre-review checklist:

- The model reviews like a maintainer: it understands the intent, reads the code around each change, checks correctness and side effects before conventions, proposes a fix for every problem and asks when unsure.
- The output is **one GitHub review** of inline comments on the changed lines, labelled 🔴 blocking / 🟠 issue / 💡 suggestion / ❓ question / ⚪ nit. Small fixes come as `suggestion` blocks that the author can apply in one click. A short summary gives the assessment, the main points, what is beyond the diff and what could not be verified. The review event is always `COMMENT`: never approve or request changes.
- When inline comments cannot be posted, everything goes in a single comment instead.
- Inline comments are countable, so each one can be scored against the reference review (found / missed / false positive / new valid finding).

The variables (`${REPO}`, `${PR_NUMBER}`, `${PR_TITLE}`, `${PR_AUTHOR}`) are the ones of the ps_apiresources `ai-prereview.yml` workflow, replaced with `envsubst`.

## Using a prompt

- **Claude Code** (the baseline): copy the prompt as `.claude/REVIEW_PROMPT.md` in the sandbox fork, along with the `ai-prereview.yml` workflow from ps_apiresources. The shared workflow only allows `gh pr diff`, `gh pr view` and `gh pr comment`, which limits the review to the single-comment fallback. For inline comments, add the inline comment tool of claude-code-action to the `allowed-tools` input: `mcp__github_inline_comment__create_inline_comment,Read,Glob,Grep,LS,WebFetch,Bash(gh pr diff:*),Bash(gh pr view:*),Bash(gh pr comment:*)`.
- **Other tools**: paste the **How to review**, **Review rules** and **Writing the comments** sections into the tool's custom instructions. Most tools post inline comments on their own, so the **Posting the review** section is mostly for Claude Code. Skip the "How to inspect the PR" section, which is specific to the Claude Code run. Write down in the tool's fact sheet what the tool accepted and what it truncated, since that feeds the "Custom prompt per repo" criterion.
