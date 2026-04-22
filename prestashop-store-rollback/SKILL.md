---
name: prestashop-store-rollback
description: Restore a PrestaShop store to a previous backup. Use when the user wants to rollback independently of an ongoing update.
---

## Requirements

Ask the user:
* What is the path to the module `autoupgrade` from the store. It may be in a Docker container or behind a SSH session.
* What is the admin folder name if you don't know it. It will be needed to run commands.

## Usage:

* The commands of Update Assistant are run with `[module_path]/bin/console`,
* Commands details are provided by adding `--help` at the end.

## Steps

- Run `backup:list` and display the available backups with their dates.
- Ask the user which backup to restore (GATE).
- Run `backup:restore --backup=[name]`. This is a long process.
- Confirm the store is back and working.
