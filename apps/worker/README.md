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

## Admin auth

Everything except `/healthz` requires Basic auth against the Worker Secret `ADMIN_BASIC_AUTH` (`user:password`, set with `wrangler secret put ADMIN_BASIC_AUTH`); without it the Worker answers 503.
Cloudflare Access is not used because it cannot protect a `*.workers.dev` hostname and there is no custom zone yet.
Once a custom domain is added, put an Access application in front of it and remove the `auth` middleware.

## Monitor edit

`PUT /api/monitors/:id` takes the same body as `POST /api/monitors` (JSON, or a form with a `config` JSON field). `POST /api/monitors/:id/edit` is the same handler for HTML forms, which cannot send `PUT`.
An edit bumps `config_version`, clears the baseline and makes the monitor due now, so the next run only re-baselines. A baseline recorded under another config version is never compared against, and a run in flight during an edit does not overwrite the new schedule or baseline.

## Run locally

```sh
pnpm -F @mirowler/worker migrate:local
pnpm dev
curl 'http://localhost:8787/__scheduled?cron=*+*+*+*+*'
```

`dev` runs `wrangler dev --test-scheduled`, which exposes `/__scheduled` to trigger the cron handler. Put secrets (`ADMIN_BASIC_AUTH=user:pass`, Slack webhook URLs, etc.) in `apps/worker/.dev.vars`. Full walkthrough: root [README](../../README.md#setup).

## Checks

```sh
pnpm -F @mirowler/worker typecheck
pnpm -F @mirowler/worker test
pnpm -F @mirowler/worker exec wrangler deploy --dry-run
```
