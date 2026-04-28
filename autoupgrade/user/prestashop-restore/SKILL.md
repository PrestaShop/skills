---
name: prestashop-restore
description: Restore a PrestaShop store to a previous backup. Use when the user wants to rollback independently of an ongoing update.
---

## Requirements

Ask the user:
* What is the path to the module `autoupgrade` from the store. It may be in a Docker container or behind a SSH session.
* What is the admin folder name if you don't know it. It will be needed to run commands.
* The param `-q` avoids unecessary contents to be displayed. If you need to access the logs after a backup, an update or a restore, you can find them in `[admin_path]/autoupgrade/logs/` with files in the format `[year]-[month]-[day]-[time]-[action].txt`.

## Usage:

* The commands of Update Assistant are run with `[module_path]/bin/console`,
* Commands details are provided by adding `--help` at the end.

## Steps

- Run `backup:list` and display the available backups with their dates.
- Ask the user which backup to restore (GATE).
- Run `backup:restore --backup=[name] -q`. This is a long process.
- Confirm the store is back and working.
