# AI review prompts

Shared pre-review prompts for the AI review tools evaluation ([PrestaShop/PrestaShop#42950](https://github.com/PrestaShop/PrestaShop/issues/42950)). Every tool gets the same prompt for a given repository, so the results can be compared.

| Prompt | Repository | Guidelines it reads first |
| --- | --- | --- |
| [`core.md`](core.md) | PrestaShop/PrestaShop | `.ai/CONTEXT.md`, `.ai/GOTCHAS.md`, the domain and component contexts the PR touches |
| [`module.md`](module.md) | native modules, tested on ps_facetedsearch | none in the repo: the rules are in the prompt, with a ps_facetedsearch section |
| [`theme.md`](theme.md) | themes, tested on Hummingbird | `CONTEXT.md`, `PRODUCT.md`, `CONTRIBUTING.md` |
| [ps_apiresources](https://github.com/PrestaShop/ps_apiresources/blob/dev/.claude/REVIEW_PROMPT.md) | PrestaShop/ps_apiresources | `CONTEXT.md` (prompt kept in that repository) |

## Format

The prompts follow the ps_apiresources one, so they plug into the same `ai-prereview.yml` workflow:

- `${REPO}`, `${PR_NUMBER}`, `${PR_TITLE}` and `${PR_AUTHOR}` are replaced with `envsubst`.
- The run is limited to reading files, `gh pr diff`, `gh pr view`, `gh pr comment` and `WebFetch`, so CI checks are reasoned about, not run.
- The output is a single comment starting with `<!-- ai-prereview -->`.
- Each comment has a numbered **Findings** list with a severity and a `path:line`, so every finding can be scored against the reference review (found / missed / false positive / new valid finding).

## Using a prompt

- **Claude Code** (the baseline): copy the prompt as `.claude/REVIEW_PROMPT.md` in the sandbox fork, along with the `ai-prereview.yml` workflow from ps_apiresources.
- **Other tools**: paste the **Review rules** section into the tool's custom instructions, plus the findings rules of the **Output format** section when the tool accepts an output format. Skip the "How to inspect the PR" section, which is specific to the Claude Code run. Write down in the tool's fact sheet what the tool accepted and what it truncated, since that feeds the "Custom prompt per repo" criterion.
