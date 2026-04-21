---
name: prestashop-store-check
description: Check if a PrestaShop store is ready to be updated. Use when the user wants to assess compatibility or available versions without starting an update.
---

## Requirements

Find out what is the path to the module `autoupgrade`. It may be in a Docker container or behind a SSH session.
* The commands are run with `[module_path]/bin/console`,
* Commands details are provided by adding `--help` at the end.

## Steps

- Run `update:check-new-version` and display available versions. Ask the user to select the canal that will be used during the next steps: `online_recommended` (default), `online` or local. `local` requires the zip and xml files of the newer version of PrestaShop to be present in `[shop_admin]/autoupgrade/download/`.
- Check the compatibility of the store with `update:check-requirements`.
- Check the posts related to the current version of Update Assistant on https://github.com/PrestaShop/autoupgrade/discussions/categories/known-issues?discussions_q=is%3Aopen+category%3A%22Known+issues%22+label%3A%22Impacts%3A+[version]%22 by replqcing [version] with the current major.minor version of the module. It can be found by running `[module_path]/bin/console` without any parameter.
- If there are errors, explain each one and suggest fixes — but do not fix anything automatically.
- Conclude with a clear go / no-go recommendation.
