# CLAUDE.md

## Role

This file is the tool-specific entry point Claude Code follows in this repository. Project knowledge lives in `README.md` and the per-package READMEs; here we only cover Claude Code's read order, execution boundaries, and where to find supporting knowledge.

## Read order

1. `README.md`
2. The relevant package README (`apps/worker/README.md` or `packages/core/README.md`)
3. `.claude/rules/`
4. Relevant `.claude/skills/` (if any)

## Claude Code specific principles

- Don't duplicate project knowledge here; that belongs in `README.md` and the package READMEs
- Read the relevant README before changing a package
- For broad changes or ones that affect behavior, run at least `pnpm ai:verify:fast`
- Before wrapping up a broad change, prefer `pnpm ai:verify`
- Deploys, releases, and any use of production-equivalent credentials happen only when explicitly requested
- Act consistently with the `permissions` settings in `.claude/settings.json`
- `.claude/hooks/` runs Biome automatically after `Edit`, `Write`, and `MultiEdit`, and queues an async typecheck for the affected package (`packages/core` or `apps/worker`)
- `git commit` is validated by `.claude/hooks/` against commitlint; violations are blocked. See `.claude/rules/commit-message.md`

## References

- Basic rules: `.claude/rules/repo-basics.md`
- Verification boundary: `.claude/rules/verification.md`
- Commit message convention: `.claude/rules/commit-message.md`
- Coding style: `.claude/rules/coding-styles-common.md`, `.claude/rules/coding-styles-core.md`, `.claude/rules/coding-styles-worker.md`
- Testing: `.claude/rules/testing.md`
- Hooks configuration: `.claude/settings.json`
