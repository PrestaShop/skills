---
name: prestashop-store-update
description: Update a PrestaShop store by using the Module Update Assistant. Use when the user asks to update a store or assess the compatibility with the newer versions of PrestaShop.
---

# PrestaShop - Updating to a newer version of PrestaShop

## Requirements

Find out what is the path to the module `autoupgrade`. It may be in a Docker container or behind a SSH session.
* The commands are run with `[module_path]/bin/console`,
* Commands details are provided by adding `--help` at the end.

## Steps

- Run `update:check-new-version` and display available versions (GATE). Ask the user to select the canal that will be used during the next steps: `online_recommended` (default), `online` or local. `local` requires the zip and xml files of the newer version of PrestaShop to be present in `[shop_admin]/autoupgrade/download/`.
- Check the compatibility of the store with `update:check-requirements`.
- Check the posts related to the current version of Update Assistant on https://github.com/PrestaShop/autoupgrade/discussions/categories/known-issues?discussions_q=is%3Aopen+category%3A%22Known+issues%22+label%3A%22Impacts%3A+[version]%22 by replacing [version] with the current major.minor version of the module. It can be found by running `[module_path]/bin/console` without any parameter.
- If there are errors, investigate and request confirmation to fix them (automatically if there is a way to do so, wait for the user to suggest a fix, wait for the user to fix it himself) and run the command again (GATE).
- When there are no more errors (warnings are acceptable), ask the user if he want to proceed with the update (GATE).
- Backup the store with `backup:create`. This is a long process depending on the size of the store.
- Run the update with `update:start`. This is a long process depending on the size of the store.
- If the process ends with a successful message, let the user know it is possible to use the store and make sure everything works as expected (GATE).
- In case of issue, the backup created by Update Assistant can be restored with `backup:restore`. This is a long process depending on the size of the store.
