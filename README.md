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

4. Create `apps/worker/.dev.vars`. `ADMIN_BASIC_AUTH` is required; add a line per channel secret (e.g. `SLACK_WEBHOOK_LOCAL=https://hooks.slack.com/...`) only if you want real Slack delivery

   ```sh
   ADMIN_BASIC_AUTH=admin:localpass
   ```

5. Start the dev server (`wrangler dev --test-scheduled`, on `http://localhost:8787`)

   ```sh
   pnpm dev
   ```

6. Register a channel, then a monitor using the returned channel id

   ```sh
   curl -u admin:localpass -H 'content-type: application/json' \
     -d '{"displayName":"local","secretName":"SLACK_WEBHOOK_LOCAL"}' \
     http://localhost:8787/api/channels
   curl -u admin:localpass -H 'content-type: application/json' \
     -d '{"name":"example","schedule":{"type":"interval","minutes":1},"source":{"type":"http","url":"https://example.com/"},"extractor":{"type":"css_text","selector":"h1","parse":"text"},"evaluator":{"type":"rule","field":"text","op":"contains","value":"Example"},"trigger":{"type":"on_enter"},"channelIds":["<channel id>"]}' \
     http://localhost:8787/api/monitors
   ```

7. Trigger the scheduled handler and read the run it recorded

   ```sh
   curl 'http://localhost:8787/__scheduled?cron=*+*+*+*+*'
   curl -u admin:localpass http://localhost:8787/api/monitors/<monitor id>/runs
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

CI runs `pnpm ai:verify` and a worker deploy dry run (`pnpm -F @mirowler/worker deploy:dry-run`) on every pull request and on pushes to `main`.
