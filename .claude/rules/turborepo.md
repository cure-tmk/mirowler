# Turborepo

## Purpose

What to check before changing Turborepo configuration (`turbo.json`) or `turbo` commands.

## Required

- The installed `turbo` may behave differently from what you remember. Its version is pinned in the root `package.json`; confirm it with `node -p "require('turbo/package.json').version"`.
- Read `node_modules/turbo/docs/README.md` first, then the relevant pages under `node_modules/turbo/docs/`. These docs ship with the installed version and work offline. Heed their deprecation notices.
- `"agentGuidance": false` in `turbo.json` stops `turbo` from writing its agent guidance into a root `AGENTS.md`; this file carries that guidance instead. Do not re-enable it or commit an `AGENTS.md`.
