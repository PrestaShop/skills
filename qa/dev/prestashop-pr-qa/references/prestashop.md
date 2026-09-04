# What a PrestaShop shop does to your test

## Contents

The order below is the order a QA run needs them in.

* Reading the pull request: the linked issue, the merge base, the PR-dependency probe
* Where the code sits: core, module, theme, and what actually needs building
* Making a change visible: caches, opcache, the canary
* What a code downgrade cannot undo: when a checkout does not reset the database
* Modules: `vendor/`, the three versions a module carries, a disabled module
* Themes: the two versions a theme carries, and where the installed one lives
* Back office: the admin folder, the CSRF token, per-controller tokens
* Assessing files the merchant changed

## Reading the pull request

* Reproduction steps, the affected version and the reporter's own screenshots usually live in the **linked issue**, not the PR. `gh pr view N --json closingIssuesReferences` finds it. Where the steps sit in the PR body itself is covered by the workflow in `SKILL.md`.
* The code from before *this* PR is its **merge base**, not the tip of the base branch, which carries everything merged since the PR branched.
* Reading the pull request is yours to do; **preparing the ground is the developer's.** The first command below only asks GitHub a question, so run it. The next two are theirs: one writes a ref into their repository, the other needs that ref. Print them, ask, wait.

```bash
gh pr view "$PR" --repo "$REPO" --json baseRefName,headRefOid   # a read, run it

# the developer's, because both touch their repository
git fetch origin "pull/$PR/head:refs/qa/pr-$PR"
git merge-base "refs/qa/pr-$PR" "origin/$BASE_REF"
```

* **A PR may depend on another PR without saying so.** Before reporting that a feature does not work, check whether the symbols it relies on exist in the shop at all:

```bash
gh pr diff "$PR" --repo "$REPO" | grep '^+' | grep -oE '\$[a-zA-Z_][a-zA-Z0-9_.]*' | sort -u
grep -rl '[thatVariable]' [shop]/modules/ [shop]/themes/
```

Nothing found is a missing dependency, not a defect. If another PR has to be applied to test this one, say so in the report: the result then covers the combination, not this PR alone.

## Where the code sits

| PR is about | Code lives in | Build sources | Build command |
| --- | --- | --- | --- |
| Core | the shop root | `admin-dev/themes/default/`, `admin-dev/themes/new-theme/`, `themes/_core/js` | in the directory that owns the changed files. `src/` is PHP and builds nothing, and there is no `package.json` at the repository root |
| Module | `[shop]/modules/[name]/` | `_dev/`, `src/`, `views/_dev/` | at the module root or inside `_dev/` |
| Theme, hummingbird | `[shop]/themes/hummingbird/` | `src/js`, `src/scss` (webpack, TypeScript) | `npm run build` at the theme root |
| Theme, classic | `[shop]/themes/classic/` | `_dev/css`, `_dev/js` | `npm run build` inside `_dev/` |
| Library / SDK | pulled in through composer or npm | whatever ships it | whatever ships it |

`.tpl`, `.twig` and `.php` need no build. Anything under `src/` or `_dev/`, and every `.scss` or `.ts`, does. **Find the build rather than assuming it:** locate the `package.json` whose directory contains the changed files and read its `scripts`: the theme root for hummingbird, `_dev/` for classic, and one per workspace in the core.

**A core pull request usually needs no build at all**, because `src/` and `classes/` are PHP and nothing compiles them. Only three directories in the core carry front-end sources:

* `admin-dev/themes/default/` and `admin-dev/themes/new-theme/`, for the back office
* `themes/_core/js`, for the handful of scripts the themes share

If the diff touches none of them, offering to build is noise.

### A theme's built assets do not follow a git checkout

Both default themes gitignore their build output, `assets/` in hummingbird and in classic, so it is untracked. Switching git refs changes the sources and leaves the compiled CSS and JS exactly as they were.

For a theme PR touching `src/` or `_dev/` that means:

* the build must run **again in each phase**, or both phases serve byte-identical assets and the canary never flips;
* worse, if the PR also touches a `.tpl`, the canary *will* flip on the template while the CSS and JS stay behind from the other phase. That mixed state reads exactly like a real measurement. Rebuild first, then take the canary reading.

A PR touching only `templates/` needs no build: Smarty recompiles on mtime change.

## Making a change visible

* **Twig, PHP and YAML** need `php bin/console cache:clear`. Clear both environments, because the front office and back office may not run in the same one.
* **Smarty templates** (`.tpl`) recompile themselves; nothing to do.
* **opcache** is the silent one. With `opcache.validate_timestamps=0`, common in production-shaped containers, the new file lands on disk and never reaches the browser. If the canary refuses to move after a correct checkout and a cache clear, this is why: the PHP process has to be reloaded.
* **The canary itself:** `curl -s -L '[url]' | grep -c '[string]'`. curl has no cache, no service worker and no browser profile, so it reports what the server actually serves. Take a reading in each phase. If the two readings are identical, the shop never changed state and no result from it means anything.

**The back office cannot be canaried with `curl`.** An admin page needs a session, so `curl` gets the login form instead, and the count is equally useless in both phases.

Read it in the browser instead, after `loginBO()`. Playwright builds a fresh context per phase, with an empty cache, no service worker and no profile, so a marker read from the DOM is nearly as trustworthy as `curl`. Record it with `assert.detail` and quote both readings. If no marker can be read at all, say the canary was unobtainable, and never imply that it flipped.

## What a code downgrade cannot undo

Going back to older code does **not** go back to an older database. Rows and columns created going forward survive the checkout, so `git checkout` alone does not always reset the environment for a `before` phase.

Spot it when the diff is first read, not at the gate: once the pull request's code has run here, nothing puts the database back.

```bash
# files that are one-way by what they are
gh pr diff "$PR" --repo "$REPO" \
  | grep -E '^\+\+\+ b/.*(upgrade/upgrade-.*\.php|upgrade/.*\.sql|[Mm]igrations?/)'

# added lines that write to the database or to stored configuration
gh pr diff "$PR" --repo "$REPO" | grep '^+' \
  | grep -iE 'ALTER TABLE|CREATE TABLE|DROP (TABLE|COLUMN)|ADD COLUMN|Configuration::updateValue|registerHook|ORM\\Column'
```

Match shapes, not paths: PrestaShop 9 ships no `install/upgrade/`, while a module still carries `upgrade/upgrade-1.2.0.php`. Prefer a false positive, which costs one question, to a false negative, which costs the run.

Nothing printed, nothing to do. Something printed, and one question settles it: **has this pull request already run in this environment?** If not, a checkout is enough. If it has, a checkout is still enough when the state it left cannot reach what the scenario measures, a column nothing reads yet for instance. Otherwise the phase needs a snapshot taken before the migration ran, and without one there is no `before` phase to have: say so and cap the verdict. When you cannot tell, assume it can reach it.

Snapshots are what the [autoupgrade](https://github.com/PrestaShop/autoupgrade) module does, and the sibling skills `autoupgrade/user/prestashop-restore` and `autoupgrade/user/prestashop-update` already drive it. **Take the commands from there, never from here.** One thing to say before offering it: a restore is not a database rewind, it puts back the files too and deletes anything absent from the archive, so it overwrites the working tree. The developer decides.

## Modules

* If a `composer.json` file exists, **`composer install --no-dev` is mandatory**, not optional. A module's `vendor/` is not in git, and its classes autoload through it. Without it the module fatals on the first autoload.
* **A module carries three versions, and they disagree on purpose.** `[module].php` declares `$this->version`, `config.xml` caches the last one the shop saw, and the `ps_module` table records what is actually installed. `prestashop:module:list` gives one version and a status per module, and a dash for a module that is on disk but not installed, so it answers "is it installed and enabled" but not "do the three agree". Read the two files when the divergence is the point:

```bash
grep -m1 'this->version' [shop]/modules/[name]/[name].php     # what the checked-out code claims
grep -m1 '<version>'     [shop]/modules/[name]/config.xml     # what the shop last cached
```

  A code version ahead of the installed one is the normal state right after a checkout, and it is why the module has to be reset before the change is visible. Report the version from the code, since that is the one the pull request changes.
* **A disabled module renders nothing**, so every selector-based check passes over an empty page. Confirm it is enabled before believing a green run.

## Themes

**A theme carries two versions, like a module.** `config/theme.yml` in the theme is what the checked-out code claims. `config/themes/[theme]/shop[N].json` at the shop root is what the shop actually installed: a snapshot of that same file taken at install time, one per shop, so multistore has `shop1.json`, `shop2.json` and so on. The database only records which theme a shop uses, in `ps_shop.theme_name`, never its version.

```bash
grep -m1 '^version' [shop]/themes/[name]/config/theme.yml               # what the checked-out code claims
grep -o '"version":"[^"]*"' [shop]/config/themes/[name]/shop1.json      # what the shop installed
```

So a PR that bumps the theme version leaves the two disagreeing after a checkout, exactly as a module does, and the back office offers to update the theme. A git checkout alone does not undo that.

## Back office

* **The admin folder name differs on every installation.** Ask for it; never guess.
* **The login form carries a CSRF token.** Fill the fields and submit the form. A direct POST is rejected.
* **Legacy back-office URLs are token-signed per controller.** `index.php?controller=AdminSomething` without its token returns an "Invalid token" page that looks exactly like a broken feature. Navigate through the menu or follow a link already in the DOM instead of constructing the URL.
* Symfony-based back-office pages take normal routes and need `cache:clear` after a Twig or PHP change.

## Assessing files the merchant changed

If the shop turns out to carry modified core or theme files, diff them against the original before concluding anything about the PR:

* core: `https://raw.githubusercontent.com/PrestaShop/PrestaShop/refs/tags/[version]/[path]`
* theme: `https://raw.githubusercontent.com/PrestaShop/[theme]/refs/tags/[version in config/theme.yml]/[path]`

`index.php` files are excluded from both checks. Business-critical customisations belong in a [module](https://devdocs.prestashop-project.org/9/modules/creation/), or for a theme in a [child theme](https://devdocs.prestashop-project.org/9/themes/reference/template-inheritance/parent-child-feature/).

