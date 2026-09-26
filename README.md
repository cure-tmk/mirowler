# mirowler

A single Cloudflare Worker that periodically fetches public web pages, extracts a value via a CSS selector, evaluates rules or changes against the previous valid observation, and posts to a Slack Incoming Webhook only when a condition is entered.

## Architecture

- One Cloudflare Worker, combining a Hono-based HTTP API and admin UI with a Cron Trigger for scheduled runs (the `scheduled` handler), persisted to D1.
- `packages/core`: the runtime-dependency-free domain layer. Holds monitor types and zod schemas, ports (function types) for interacting with the outside world, and the evaluate / trigger / schedule / parse / run pipeline.
- `apps/worker`: implements `packages/core`'s ports on the Cloudflare Workers runtime (HTTP fetch, CSS extraction, Slack notification adapters), reads and writes D1, and wires up the Hono API, admin UI, and scheduled execution.

## Directories

- `apps/worker`: the Cloudflare Worker itself (`@mirowler/worker`). See [apps/worker/README.md](./apps/worker/README.md)
- `packages/core`: domain logic (`@mirowler/core`). See [packages/core/README.md](./packages/core/README.md)
- `.claude`: hooks and rules for Claude Code

## Setup

1. Match the Node version (e.g. via [mise](https://mise.jdx.dev/), which reads `.node-version`)
2. Install dependencies

   ```sh
   pnpm install
   ```

3. Apply migrations to local D1

   ```sh
   pnpm -F @mirowler/worker migrate:local
   ```

4. Create `apps/worker/.dev.vars` and set `ADMIN_BASIC_AUTH` and the Slack webhook secret
5. Start the dev server

   ```sh
   pnpm dev
   ```

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start `apps/worker`'s dev server (`wrangler dev`) |
| `pnpm check` / `pnpm fix` | Biome check / autofix |
| `pnpm typecheck` | Typecheck all workspaces (turbo) |
| `pnpm test` | Test all workspaces (turbo) |
| `pnpm ai:verify:fast` | `check` + `typecheck` |
| `pnpm ai:verify` | `check` + `typecheck` + `test` |
| `pnpm deploy` | Deploy all workspaces (turbo) |
| `pnpm -F @mirowler/core typecheck` / `test` | core only |
| `pnpm -F @mirowler/worker typecheck` / `test` / `dev` / `deploy` / `migrate:local` | worker only |
