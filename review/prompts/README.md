# AI review prompts

Shared review prompts for the AI review tools evaluation ([PrestaShop/PrestaShop#42950](https://github.com/PrestaShop/PrestaShop/issues/42950)). Every tool gets the same prompt for a given repository, so the results can be compared.

| Prompt | Repository | Guidelines it reads first |
| --- | --- | --- |
| [`core.md`](core.md) | PrestaShop/PrestaShop | `.ai/CONTEXT.md`, `.ai/GOTCHAS.md`, the domain and component contexts the PR touches |
| [`module.md`](module.md) | native modules | none in the repo: generic module rules in the prompt, plus ps_facetedsearch and productcomments sections |
| [`theme.md`](theme.md) | themes, starting with Hummingbird | `CONTEXT.md`, `PRODUCT.md`, `CONTRIBUTING.md` |
| [`apiresources.md`](apiresources.md) | PrestaShop/ps_apiresources | `CONTEXT.md`. The [`REVIEW_PROMPT.md`](https://github.com/PrestaShop/ps_apiresources/blob/dev/.claude/REVIEW_PROMPT.md) kept in that repository is the pre-review checklist, a different exercise |

## Format

The prompts are **agent-agnostic**: they name no tool specific to one agent, so the same text works for every tool of the evaluation. They ask for an actual review, not a pre-review checklist:

- The reviewer works like a maintainer: it understands the intent, reads the code around each change, checks correctness and side effects before conventions, proposes a fix for every problem and asks when unsure.
- Comments are inline on the changed lines, labelled 🔴 blocking / 🟠 issue / 💡 suggestion / ❓ question / ⚪ nit. Small fixes come as `suggestion` blocks that the author can apply in one click.
- A short summary gives the assessment, the main points, what is beyond the diff and what could not be verified. The review never approves or requests changes.
- When inline comments are not possible, everything goes in a single comment.
- Inline comments are countable, so each one can be scored against the reference review (found / missed / false positive / new valid finding).
- A last section, **Working from a shell**, is for agents run from a terminal or CI (Claude Code, Open Code Review, ...): how to read the PR and post the review with the `gh` CLI, or the GitHub REST API when `gh` is not installed. GitHub apps that post their own reviews skip it.

## Using a prompt

- **GitHub apps** (CodeRabbit, Greptile, Qodo, Cubic, ...): paste the prompt of the repository into the tool's custom instructions.
- **Agents run from a terminal or CI**: give the PR URL and the prompt, for example:

  ```bash
  claude -p "Review https://github.com/<owner>/<repo>/pull/<number>. $(cat review/prompts/core.md)"
  ```

Write down in the tool's fact sheet what the tool accepted, truncated or ignored (size limit, output format), since that feeds the "Custom prompt per repo" criterion.
