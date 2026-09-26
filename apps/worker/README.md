# @mirowler/worker

## Responsibility

A single Cloudflare Worker that serves the admin UI, the API and the cron run. It stores `@mirowler/core` results in D1 and notifies Slack.

## Directories

- `src/http`: Hono API, admin UI (hono/jsx) and Basic auth
- `src/scheduled`: cron handler that claims due monitors, runs them and retries pending notifications
- `src/adapters`: core port implementations (HTTP fetch, HTMLRewriter extraction, Slack notification)
- `src/db`: small functions wrapping D1 queries
- `migrations`: D1 schema

## Not here

Business decisions (value parsing, rule evaluation, event decisions) live in core.

## Run locally

```sh
pnpm -F @mirowler/worker migrate:local
pnpm dev
```

Put secrets (`ADMIN_BASIC_AUTH=user:pass`, Slack webhook URLs, etc.) in `apps/worker/.dev.vars`.

## Checks

```sh
pnpm -F @mirowler/worker typecheck
pnpm -F @mirowler/worker test
pnpm -F @mirowler/worker exec wrangler deploy --dry-run
```
