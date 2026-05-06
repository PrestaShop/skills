---
name: prestashop-update
description: Update a PrestaShop store by using the Module Update Assistant. Use when the user asks to update a store or assess the compatibility with the newer versions of PrestaShop.
---

# PrestaShop - Updating to a newer version of PrestaShop

## Requirements

Ask the user:
* What is the path to the module `autoupgrade` from the store. It may be in a Docker container or behind a SSH session.
* What is the admin folder name if you don't know it. It will be needed to run commands.

## Usage:

* The commands of Update Assistant are run with `[module_path]/bin/console`,
* Commands details are provided by adding `--help` at the end.
* The param `-q` avoids unecessary contents to be displayed. If you need to access the logs after a backup, an update or a restore, you can find them in `[admin_path]/autoupgrade/logs/` with files in the format `[year]-[month]-[day]-[time]-[action].txt`.

## Steps

- Run `update:check-new-version` and display available versions (GATE). 3 channels may appear: `online_recommended` (default), `online` or local. `online_recommended` and `online` may not always appear. `local` requires the zip and xml files of the newer version of PrestaShop to be present in `[shop_admin]/autoupgrade/download/`. Ask the user to select the channel that will be used during the next steps
- Check the compatibility of the store with `update:check-requirements`. Additional checks can be done when specific feedback is displayed:
  - If the core files are modified (except index.php files and modules), you can assess how the changes are critical to the merchants by diffing from the original file on GitHub with the URL https://raw.githubusercontent.com/PrestaShop/PrestaShop/refs/tags/[prestashop_source_version]/[path_to_file_from_root_store] (the placeholders have to be replaced with actual values). If the changes are critical for the business, recommend to move them in a [module](https://devdocs.prestashop-project.org/9/modules/creation/) to avoid loosing them, or as last resort an [override](https://devdocs.prestashop-project.org/9/modules/concepts/overrides/).
  - If theme files are modified (except index.php files), you can assess how the changes are critical to merchants by diffing from the original file on GitHub with the URL https://raw.githubusercontent.com/PrestaShop/[theme_name]/refs/tags/[version_in_config/theme.yml_of_the_theme]/[path_to_file_from_root_store] (the placeholders have to be replaced with actual values). If the changes are critical for the business, recommend to move them in a [child theme](https://devdocs.prestashop-project.org/9/themes/reference/template-inheritance/parent-child-feature/) to avoid loosing them. This is only when assessing changes from default PrestaShop themes: `classic`, and `hummingbird`.
- Check the posts related to the current version of Update Assistant on https://github.com/PrestaShop/autoupgrade/discussions/categories/known-issues?discussions_q=is%3Aopen+category%3A%22Known+issues%22+label%3A%22Impacts%3A+[version]%22 by replacing [version] with the current major.minor version of the module. It can be found by running `[module_path]/bin/console` without any parameter.
- Conclude with a clear go / no-go recommendation with a summary of errors / warnings / successes using the Severity levels below. If there are errors, investigate and request confirmation to fix them (automatically if there is a way to do so, wait for the user to suggest a fix, wait for the user to fix it himself) and run the command again (GATE).
- When there are no more errors (warnings are acceptable), ask the user if he want to proceed with the update (GATE).
- Backup the store with `backup:create -q`. This is a long process depending on the size of the store.
- Run the update with `update:start -q` (TODO: Add param to know the command is run by an agent in analytics). This is a long process depending on the size of the store.
- If the process ends with a successful message, let the user know it is possible to use the store and make sure everything works as expected (GATE).
- In case of issue, the backup created by Update Assistant can be restored with `backup:restore`. This is a long process depending on the size of the store.

### Severity levels

| Marker  | Severity | Meaning                                                                   |
|:--------|:---------|:--------------------------------------------------------------------------|
| 🔴      | Error    | An issue that must be fixed before updating                               |
| 🟡      | Warning  | Minor issue, worth fixing but not blocking                                |
| 🟢      | OK       | A check that did not returned anything to fix or confirmed the readyness  |
