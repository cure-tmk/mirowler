# Verification Boundary

## Purpose

A basis for picking a verification command proportionate to the change.

## Baseline

- Right after an edit, default to `pnpm ai:verify:fast` (`pnpm check` + `pnpm typecheck`).
- Before wrapping up, for changes spanning multiple areas or changing behavior, prefer `pnpm ai:verify` (adds `pnpm test`).

## Guidance

- `README.md` / `.claude/` only
  - Visually check links and navigation.
- Changes under `packages/core/`
  - `pnpm -F @mirowler/core typecheck` and `pnpm -F @mirowler/core test`
  - When unsure, use `pnpm ai:verify:fast`
- Changes under `apps/worker/`
  - `pnpm -F @mirowler/worker typecheck` and `pnpm -F @mirowler/worker test`
  - If `wrangler.jsonc`, `migrations/`, or binding configuration changed, also run `pnpm -F @mirowler/worker deploy --dry-run`
- `package.json`, `biome.json`, `tsconfig.base.json`, CI config changes
  - `pnpm ai:verify:fast`
- High-risk or cross-cutting changes
  - `pnpm ai:verify`

## Notes

- If you don't rerun everything locally, say explicitly what was left unverified.
- Only run `wrangler deploy` (beyond dry-run), or an actual deploy, when explicitly requested.
