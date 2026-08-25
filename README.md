# PrestaShop Skills

Welcome to the **PrestaShop Skills** repository! This repository serves as a centralized collection of AI "skills" designed to help you interact with, manage, and develop for PrestaShop. These skills cover various domains including PrestaShop modules, core components, and themes.

## ⚠️ Security & Disclaimer

**Use with caution, especially in production environments.** These skills provide instructions to AI agents that may execute CLI commands (e.g., `bin/console`), modify files, or trigger critical processes like backups and restorations.
- **Always review** the commands and actions proposed by your AI assistant before allowing it to execute them on a live or production store.
- We recommend testing skills on a staging or local environment first.

## ✅ Prerequisites

To use these skills, you will need:
- **Node.js / npm**: Required to run the `npx skills` command.
- **An AI Assistant / Agent**: A compatible AI development tool (such as Cursor, GitHub Copilot CLI, or other agentic frameworks) capable of reading and executing instructions from the installed skills.

## 🚀 Installation & Usage

You can easily install the skills you need by using the `npx skills` CLI. The command will list the available skills in the targeted directory and install them directly into the compatible AI assistants present on your system.

**General Command syntax:**

```bash
npx skills install PrestaShop/skills/[application]/[user|dev]
```

**Installation Example:** To install operational user skills for the `autoupgrade` module:

```bash
npx skills install PrestaShop/skills/autoupgrade/user
```

_(For more details on the `npx skills` commands and mechanics, please refer to the [vercel-labs/skills repository](https://github.com/vercel-labs/skills))._

## 📚 Available Skills Inventory

As this repository grows, this list will be updated. Here is a summary of the skills currently available:

### Domain: `autoupgrade`

| Category | Skill Folder | Skill Name | Description |
| --- | --- | --- | --- |
| `user` | `prestashop-restore` | **prestashop-store-rollback** | Restore a PrestaShop store to a previous backup. Use when you need to rollback, for example, if an update fails or if you need to restore a previous state of the store. |
| `user` | `prestashop-update` | **prestashop-store-update** | Update a PrestaShop store by using the Module Update Assistant. Evaluates compatibility and proceeds with the upgrade. |
| `user` | `prestashop-update-check` | **prestashop-store-check** | Check if a PrestaShop store is ready to be updated. Assesses compatibility and available versions without starting the actual update. |

### Domain: `qa`

| Category | Skill Folder | Skill Name | Description |
| --- | --- | --- | --- |
| `dev` | `prestashop-pr-qa` | **prestashop-pr-qa** | QA a pull request against a running environment, in a browser, on the command line or over HTTP: reproduce the bug, verify the fix, and report whether it is approved, with the recording as proof. |

## 🗂️ Repository Structure

The repository is organized by **application domains**. Currently, the supported domains include:

- [`autoupgrade`](#domain-autoupgrade) (Module Update Assistant)
- [`qa`](#domain-qa) (Quality assurance on pull requests)

_(More domains like core, specific modules, and themes will be added over time)._

Inside each application domain, skills are divided into two specific target audiences:

- 🧑‍💻 **`user`**: Skills intended for store owners, merchants, and agencies. These allow you to perform operational actions on your PrestaShop store using AI (e.g., updating the store, checking compatibility, or restoring backups).
- 🛠️ **`dev`**: Skills intended for developers. These are tailored to help build, debug, and enhance the application domain itself.

**Directory tree example:**

```text
PrestaShop/skills/
├── autoupgrade/          # Domain
│   ├── user/             # User-facing operational skills
│   │   ├── prestashop-update/
│   │   ├── prestashop-restore/
│   │   └── ...
│   └── dev/              # Developer-facing skills
├── qa/                   # Domain
│   └── dev/
│       └── prestashop-pr-qa/
│           ├── SKILL.md
│           ├── references/   # Long knowledge, read on demand
│           └── scripts/      # Code the skill runs, shipped rather than retyped
└── README.md             # This file
```

## 🤝 How to Contribute

Contributions to add new application domains, user skills, or developer skills are highly encouraged!

To create a new skill:
1. Create a new directory for your skill under the appropriate domain and category (e.g., `[domain]/[user|dev]/[skill-name]`).
2. Add a `SKILL.md` file in that directory.
3. Use the required frontmatter for the skill name and description:
   ```yaml
   ---
   name: your-skill-name
   description: A short description of what the skill does.
   ---
   ```
4. Write the detailed, step-by-step instructions for the AI to follow in the rest of the markdown file.
5. Keep `SKILL.md` for what the AI has to *decide*. Knowledge it only needs in order to *execute*, command recipes, domain lore, templates, goes in a `references/` file linked from there, so it is read on demand instead of loaded every time.
6. Put executable steps in `scripts/`, not in the markdown. Anything that must run the same way every time, a validation, a guard, a runner, goes in a file the AI runs by its path. A script pasted into `SKILL.md` is retyped on every run: it cannot be linted, tested or diffed, and one line retyped differently changes the result with nothing in the diff to show for it.
7. One paragraph per line, no hard wrapping. Editors soft wrap on their own, and the next person whose editor reflows on save produces a diff where nothing changed. Tables stay compact (`| a | b |`), never padded. One blank line between blocks, never two.
8. Open a Pull Request!

### 📖 Helpful Resources for Building Skills

If you are new to writing AI skills, here are some great resources and tutorials to help you understand how to write effective instructions for AI agents:
- [Anthropic: Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) - The rules this repository follows: frontmatter limits, a `SKILL.md` body under 500 lines, progressive disclosure, references one level deep, and a checklist to run before opening a PR.
- [Anthropic Cookbook: Custom Skills Development](https://platform.claude.com/cookbook/skills-notebooks-03-skills-custom-development) - A great tutorial on how to structure and develop custom skills.
- [Vercel Labs Skills Repository](https://github.com/vercel-labs/skills) - The core engine that powers the `npx skills` command, containing examples and documentation on how the framework operates under the hood.
