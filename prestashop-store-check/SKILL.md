---
name: prestashop-store-check
description: Check if a PrestaShop store is ready to be updated. Use when the user wants to assess compatibility or available versions without starting an update.
---

## Requirements

Ask the user:
* What is the path to the module `autoupgrade` from the store. It may be in a Docker container or behind a SSH session.
* What is the admin folder name if you don't know it. It will be needed to run commands.

## Usage:

* The commands of Update Assistant are run with `[module_path]/bin/console`,
* Commands details are provided by adding `--help` at the end.

## Steps

- Run `update:check-new-version` and display available versions (GATE). 3 channels may appear: `online_recommended` (default), `online` or local. `online_recommended` and `online` may not always appear. `local` requires the zip and xml files of the newer version of PrestaShop to be present in `[shop_admin]/autoupgrade/download/`. Ask the user to select the channel that will be used during the next steps
- Check the compatibility of the store with `update:check-requirements`.
- Check the posts related to the current version of Update Assistant on https://github.com/PrestaShop/autoupgrade/discussions/categories/known-issues?discussions_q=is%3Aopen+category%3A%22Known+issues%22+label%3A%22Impacts%3A+[version]%22 by replacing [version] with the current major.minor version of the module. It can be found by running `[module_path]/bin/console` without any parameter.
- If there are errors, explain each one and suggest fixes — but do not fix anything automatically.
- Conclude with a clear go / no-go recommendation with a summary of errors / warnings / successes using the Severity levels below.

### Severity levels

| Marker  | Severity | Meaning                                                                   |
|:--------|:---------|:--------------------------------------------------------------------------|
| 🔴      | Error    | An issue that must be fixed before updating                               |
| 🟡      | Warning  | Minor issue, worth fixing but not blocking                                |
| 🟢      | OK       | A check that did not returned anything to fix or confirmed the readyness  |
