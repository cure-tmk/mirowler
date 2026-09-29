# Repo Basics

## Purpose

The minimal rules Claude Code follows first in this repository.

## Read order

1. The `README.md` relevant to your scope (root, `apps/worker/README.md`, `apps/web/README.md`, `apps/cli/README.md`, `packages/core/README.md`)
2. `.claude/rules/`
3. Relevant `.claude/skills/` (if any)

## Required

- Never edit generated files directly (`apps/worker/worker-configuration.d.ts` is blocked mechanically via `permissions.deny` in `.claude/settings.json`; regenerate with `pnpm -F @mirowler/worker types`). `apps/worker/dist/api` and `apps/web/styled-system` are generated and not committed
- Don't mix the responsibilities of `packages/core`, `apps/worker`, `apps/web` and `apps/cli` (boundaries are in `coding-styles-core.md`, `coding-styles-worker.md`, `apps/web/README.md` and `apps/cli/README.md`)
- `apps/cli` is an `/api` client like `apps/web`: no domain logic, no D1
- Only commit, push, deploy, run `wrangler login`, or create a D1 database when explicitly requested
- Never write secrets (Slack webhook URLs, etc.) into code, config, or logs
- Issues follow `.github/ISSUE_TEMPLATE/task.md` and PRs follow `.github/pull_request_template.md`; altitude rules are in `writing-issues-and-prs.md`

## What not to do

- Don't run `pnpm install` unless you're adding a dependency
- Don't edit `apps/worker/worker-configuration.d.ts`. If it's stale, regenerate with `pnpm -F @mirowler/worker types`
- Don't commit, push, or open a PR unless explicitly asked

## Verification commands

See `verification.md` for details. At minimum:

- Right after an edit: `pnpm ai:verify:fast`
- Before wrapping up: `pnpm ai:verify`
- After changing worker config: `pnpm -F @mirowler/worker deploy:dry-run`
