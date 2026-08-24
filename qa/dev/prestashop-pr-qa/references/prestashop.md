# What a PrestaShop shop does to your test

## Contents

The order below is the order a QA run needs them in.

* Reading the pull request: the linked issue, the merge base, the PR-dependency probe
* Where the code sits: core, module, theme, and what actually needs building
* Making a change visible: caches, opcache, the canary
* What a code downgrade cannot undo: one-way migrations
* Modules: `vendor/`, the three versions a module carries, a disabled module
* Themes: the version bump in `config/theme.yml`
* Back office: the admin folder, the CSRF token, per-controller tokens
* Assessing files the merchant changed

## Reading the pull request

* Reproduction steps, the affected version and the reporter's own screenshots usually live in the **linked issue**, not the PR. `gh pr view N --json closingIssuesReferences` finds it. Where the steps sit in the PR body itself is covered by the workflow in `SKILL.md`.
* The code from before *this* PR is its merge base, not the tip of the base branch. The tip carries everything merged since the PR branched. Reading the pull request is yours to do; **preparing the ground is the developer's**. The first command only asks GitHub a question, so run it. The next two write into their repository, one by creating a ref and one by needing that ref: print them, ask, wait.

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

A core pull request usually needs no build at all. `src/` is PHP, `classes/` is PHP, and neither is compiled by anything. Only three directories in the core repository carry front-end sources: `admin-dev/themes/default/` and `admin-dev/themes/new-theme/` for the back office, and `themes/_core/js` for the handful of scripts the themes share. If the diff touches none of them, there is nothing to build and offering to build is noise.

### A theme's built assets do not follow a git checkout

Both default themes gitignore their build output, `assets/` in hummingbird and in classic, so it is untracked. Switching git refs changes the sources and leaves the compiled CSS and JS exactly as they were.

For a theme PR touching `src/` or `_dev/` that means:

* the build must run **again in each phase**, or both phases serve byte-identical assets and the canary never flips;
* worse, if the PR also touches a `.tpl`, the canary *will* flip on the template while the CSS and JS stay behind from the other phase. That mixed state reads exactly like a real measurement. Rebuild first, then take the canary reading.

A PR touching only `templates/` needs no build: Smarty recompiles on mtime change.

### A theme's composer.json is not a module's

hummingbird ships a `composer.json`, but with an empty `require`, no `autoload` section, and only dev tooling in `require-dev` (`header-stamp`, `autoindex`). None of it is needed to serve the theme, so **a theme needs no `composer install`**, unlike a module, whose `vendor/` is absent from git and whose classes autoload through it.

## Making a change visible

* **Twig, PHP and YAML** need `php bin/console cache:clear`. Clear both environments, because the front office and back office may not run in the same one.
* **Smarty templates** (`.tpl`) recompile themselves; nothing to do.
* **opcache** is the silent one. With `opcache.validate_timestamps=0`, common in production-shaped containers, the new file lands on disk and never reaches the browser. If the canary refuses to move after a correct checkout and a cache clear, this is why: the PHP process has to be reloaded.
* **The canary itself:** `curl -s -L '[url]' | grep -c '[string]'`. curl has no cache, no service worker and no browser profile, so it reports what the server actually serves. Take a reading in each phase. If the two readings are identical, the shop never changed state and no result from it means anything.

**The back office cannot be canaried with `curl`.** An admin page needs an authenticated session, so `curl` receives the login form rather than the page under test, and the count is identically useless in both phases. Take the reading in the browser instead, after `loginBO()`: a Playwright context is created fresh for each phase, with an empty cache, no service worker and no profile, so a marker read out of the DOM is nearly as trustworthy as `curl`. Record it with `assert.detail` and quote both readings in the report. If no marker can be read at all, say the canary was unobtainable. Never imply that it flipped.

## What a code downgrade cannot undo

Going back to the older code does **not** go back to an older database. If the diff touches any of these, a `before` phase is not sound and must be skipped with the reason stated:

* `install/upgrade/sql/`, core schema steps
* `upgrade/upgrade-*.php` in a module, one-way upgrade scripts
* `ALTER TABLE`, `ADD COLUMN`, or doctrine mapping changes
* new `ps_configuration` keys, or hooks registered in `install()`

Rows and columns created going forward stay after the checkout goes back.

## Modules

* **`composer install --no-dev` is mandatory**, not optional. A module's `vendor/` is not in git, and its classes autoload through it. Without it the module fatals on the first autoload.
* **A module carries three versions, and they disagree on purpose.** `[module].php` declares `$this->version`, `config.xml` caches the last one the shop saw, and the `ps_module` table records what is actually installed. There is no console command that lists them: `prestashop:module` only takes install, uninstall, enable, disable, reset, upgrade, configure and delete.

```bash
grep -m1 'this->version' [shop]/modules/[name]/[name].php     # what the checked-out code claims
grep -m1 '<version>'     [shop]/modules/[name]/config.xml     # what the shop last cached
```

  A code version ahead of the installed one is the normal state right after a checkout, and it is why the module has to be reset before the change is visible. Report the version from the code, since that is the one the pull request changes.
* **A disabled module renders nothing**, so every selector-based check passes over an empty page. Confirm it is enabled before believing a green run.

## Themes

The theme's version is in `config/theme.yml`. A PR that bumps it makes the back office offer to update the theme, and the shop keeps a record of the installed theme in the database, so a theme version bump is another change a git checkout alone does not undo.

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

