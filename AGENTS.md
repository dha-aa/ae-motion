# AGENTS.md

Instructions for AI agents working in this repository.

- **Installing ae-motion for a user?** Follow [INSTALL.md](INSTALL.md).
- **Changing the code or docs?** Read [CLAUDE.md](CLAUDE.md) (what this is, commands, layout, rules, After Effects
  quirks) and [CONTRIBUTING.md](CONTRIBUTING.md) (strict rules and the pre-merge checklist) first. They apply to every
  agent, not only Claude.
- **Trying a change in After Effects?** `.claude/skills/run-ae-motion/SKILL.md` explains the driver
  (`node .claude/skills/run-ae-motion/driver.ts`): call tools, save previews, reload the host script into a running
  After Effects, or test without it (`--fake`).
- **Contributing from outside?** Stop at the pull request: never bump the version, tag or release
  (CONTRIBUTING.md, section 7).
