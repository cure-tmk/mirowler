# @mirowler/worker

## Responsibility

A single Cloudflare Worker that serves the admin UI, the API and the cron run. It stores `@mirowler/core` results in D1 and notifies Slack.

## Directories

- `src/http`: Hono API, admin UI (hono/jsx) and Basic auth
- `src/scheduled`: cron handler that claims due monitors, runs them, retries pending notifications and deletes history older than the `RETENTION_DAYS` var (default 30, in `wrangler.jsonc`)
- `src/adapters`: core port implementations (HTTP fetch, HTMLRewriter extraction, Slack notification)
- `src/db`: small functions wrapping D1 queries
- `migrations`: D1 schema

## Not here

Business decisions (value parsing, rule evaluation, event decisions) live in core.

## Admin auth

Everything except `/healthz` requires Basic auth against the Worker Secret `ADMIN_BASIC_AUTH` (`user:password`, set with `wrangler secret put ADMIN_BASIC_AUTH`); without it the Worker answers 503.
Cloudflare Access is not used because it cannot protect a `*.workers.dev` hostname and there is no custom zone yet.
Once a custom domain is added, put an Access application in front of it and remove the `auth` middleware.

## Monitor create form

The top page posts structured fields to the HTML route `POST /monitors`, which builds a config from them, validates it with the shared `monitorConfigSchema` and re-renders the form with each issue next to its field (400) or redirects to the new monitor.
A separate route keeps HTML rendering out of `/api/monitors`, which stays JSON for API clients. Every field is always rendered without JavaScript; fields that do not apply to the chosen schedule, extractor or evaluator type are ignored.

## Monitor edit

`PUT /api/monitors/:id` takes the same body as `POST /api/monitors` (JSON, or a form with a `config` JSON field). `POST /api/monitors/:id/edit` is the same handler for HTML forms, which cannot send `PUT`.
An edit bumps `config_version`, clears the baseline and makes the monitor due now, so the next run only re-baselines. A baseline recorded under another config version is never compared against, and a run in flight during an edit does not overwrite the new schedule or baseline.

## Registering a stock monitor

Target URLs, selectors and condition values stay outside the repository; only the procedure lives here.

1. Save the live product page and find the element or attribute that only appears when the item can be bought (for example the label of an enabled cart button). The condition must match that positive marker, never the absence of an out-of-stock label, which is also absent after a layout change or on a block page.
2. Pick a selector built from stable classes or ids of the page layout, not from product ids, so it survives across products and variations.
3. When the state lives in an attribute (such as a button's `value`), use a `css_attr` extractor with parse `text` rather than `css_text`.
4. Evaluate it with a `rule` on `text` (`contains` the positive marker) and trigger `on_enter`, then register it with `POST /api/monitors` or the create form.
5. Trigger `POST /api/monitors/:id/run` and check `GET /api/monitors/:id/runs`: while the item is unavailable the run's `state` is `not_matched`. `unknown` means nothing was extracted (the selector is wrong or the page changed) or the fetch failed; the run's reason tells which.

The reference shape and the selectors it relies on are in the [fixtures README](test/fixtures/README.md).

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
