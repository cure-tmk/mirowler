# @mirowler/worker

## Responsibility

A single Cloudflare Worker that serves the admin UI, the API and the cron run. It stores `@mirowler/core` results in D1 and notifies Slack.

## Directories

- `src/http`: Hono API, admin UI (hono/jsx) and Basic auth
- `src/scheduled`: cron handler that claims due monitors, runs them, retries pending notifications and deletes history older than the `RETENTION_DAYS` var (default 30, in `wrangler.jsonc`)
- `src/adapters`: core port implementations (HTTP fetch, HTMLRewriter extraction, Slack notification)
- `src/db`: small functions wrapping D1 queries
- `migrations`: D1 schema

## Notification delivery

Delivery is at-least-once per (event, channel): each send is preceded by a conditional claim, so overlapping ticks and a re-run of the same run id do not post twice, and a claim left `sending` for 10 minutes is taken over.
A failed send is retried after 1, 2, 4, 8, 16, 32 and 60 minutes, about two hours in total.
After 8 attempts the notification becomes `failed` and is shown on the monitor page; the event id in the Slack text lets readers spot the rare duplicate after a timeout.

## Not here

Business decisions (value parsing, rule evaluation, event decisions) live in core.

## Admin auth

Everything except `/healthz` requires Basic auth against the Worker Secret `ADMIN_BASIC_AUTH` (`user:password`, set with `wrangler secret put ADMIN_BASIC_AUTH`); without it the Worker answers 503.
Cloudflare Access is not used because it cannot protect a `*.workers.dev` hostname and there is no custom zone yet.
Once a custom domain is added, put an Access application in front of it and remove the `auth` middleware.

## Admin API

- Every 400 has the body `{ error, issues? }`; each issue is `{ path, message }` keyed by the dotted field path (`schedule.minutes`, `source.url`, `channelIds`, ...).
- `GET /api/monitors` and `GET /api/monitors/:id` return each monitor with its health. `attention` is decided here (delayed, or at least 3 consecutive unknown runs) so clients do not duplicate the threshold. The detail adds `baseline`, the last valid observation under the current config version, or null.
- `GET /api/monitors/:id/runs` returns `{ runs, nextCursor }`, newest first, each run with its events and their per-channel delivery. Pass `nextCursor` back as `cursor` for the next page; `limit` defaults to 50 and is capped at 100. Runs that share a scheduled time are still returned exactly once.
- `DELETE /api/monitors/:id` permanently deletes the monitor with its runs, events and notifications. While a run holds a live claim it answers 409 and deletes nothing. Pausing is `POST /api/monitors/:id/disable`.
- `GET /api/channels` adds `secretConfigured`, whether the Worker Secret named by the channel is set; secret values are never returned. `PUT /api/channels/:id` edits the display name and secret name with the create validation. `DELETE /api/channels/:id` answers 409 with the monitors whose config references the channel.

## Monitor create form

The top page posts structured fields to the HTML route `POST /monitors`, which builds a config from them, validates it with the shared `monitorConfigSchema` and re-renders the form with each issue next to its field (400) or redirects to the new monitor.
`/api/monitors` serves JSON for API clients; the HTML form routes are `/monitors` (create) and `/monitors/:id/edit` (edit). Every field is always rendered without JavaScript; fields that do not apply to the chosen schedule, extractor or evaluator type are ignored.

## Monitor edit

`PUT /api/monitors/:id` takes the same body as `POST /api/monitors` (JSON, or a form with a `config` JSON field). `POST /api/monitors/:id/edit` is the same handler for HTML forms, which cannot send `PUT`.
An edit bumps `config_version`, clears the baseline and makes the monitor due now, so the next run only re-baselines. A baseline recorded under another config version is never compared against, and a run in flight during an edit does not overwrite the new schedule or baseline, although it may still emit an event computed under the old config.

## Registering a stock monitor

Target URLs, selectors and condition values stay outside the repository; only the procedure lives here.

1. Save the live product page and find the element or attribute that only appears when the item can be bought (for example the label of an enabled cart button). The condition must match that positive marker, never the absence of an out-of-stock label, which is also absent after a layout change or on a block page.
2. Pick a selector built from stable classes or ids of the page layout, not from product ids, so it survives across products and variations.
3. When the state lives in an attribute (such as a button's `value`), use a `css_attr` extractor with parse `text` rather than `css_text`.
4. Evaluate it with a `rule` on `text` (`contains` the positive marker) and trigger `on_enter`, then register it with `POST /api/monitors` or the create form.
5. Trigger `POST /api/monitors/:id/run` and check `GET /api/monitors/:id/runs`: while the item is unavailable the latest run's `state` is `not_matched`. `unknown` means nothing was extracted (the selector is wrong, the page changed, or a `css_text` selector matched a void element such as `<input>`) or the fetch failed; the run's reason tells which.

The reference shape and the selectors it relies on are in the [fixtures README](test/fixtures/README.md).

## Registering a price monitor

A monitored price is identified by everything that selects it: the page, the variant, the quantity, the plan, the currency, and whether tax and fees are included.
Put those conditions in the monitor name, for example the variant and "tax incl.", so the name says which price it tracks.
Never change them in place. An edit bumps the config version and starts a new baseline, so comparisons never mix two different prices; to track a different price, create another monitor.
An absolute threshold and a relative drop are separate monitors:

- `rule` with `lt` (or `lte`) matches while the price is below a fixed amount
- `change` with `decreased_by_percent` compares against the previous valid observation; the first valid observation is only the baseline and never notifies

Daily schedules take an IANA time zone name such as `Asia/Tokyo`.
A `change` monitor notifies on every observation that qualifies against the previous valid one, so each further drop notifies again; `trigger.type` is ignored for `change` evaluators.
A price that cannot be found or parsed, or that is zero or negative, yields `unknown`, which never notifies and never moves the baseline.

## Run locally

See the root [README Setup](../../README.md#setup).

## Checks

See [verification.md](../../.claude/rules/verification.md).
