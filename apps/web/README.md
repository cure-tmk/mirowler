# @mirowler/web

## Responsibility

The admin UI: a React single-page app built with Vite and served by the Worker as static assets. It reads and writes data only through the Worker's `/api`.

## Stack

- TanStack Router (code-based routes in `src/router.tsx`) and TanStack Query
- Park UI on Panda CSS: components and recipes are copied into `src/components/ui` and `src/theme` with `npx @park-ui/cli add <component>` (configured by `components.json`); Panda generates `styled-system/`, which is not committed
- Hono RPC client (`hc`) typed by the Worker's API type

## Screens

- `/`: monitors with health and attention
- `/monitors/:id`: summary, baseline, paged history with events and per-channel delivery, and the enable/disable, run now and delete actions. After "Run now" the history is polled until the returned run has finished
- `/channels`: channels with secret status; create, edit, delete and send test

A non-2xx response rejects with an `Error` whose message is the body's `error`; `httpStatus` and `errorBody` in `src/api.ts` read the status and body, so a screen can turn a 409 into a specific message.

## API types

The Worker emits a declaration of its route types (`pnpm -F @mirowler/worker types:api`, into `apps/worker/dist/api`) and this package imports it as `@mirowler/worker/api`.
It never typechecks the Worker source, so Workers types stay out of the browser build.
`pnpm typecheck` emits the declaration first, so changing an API response the UI relies on fails this package's typecheck.

## Auth

Static assets are public. Every `/api` request needs the Worker's Basic auth; the browser asks for it on the first API call and reuses it afterwards.
Locally the Vite dev server adds the credential from `apps/worker/.dev.vars` to proxied `/api` requests, so no prompt appears; `wrangler dev` on `:8787` itself still requires it.

## Run locally

`pnpm dev` at the root builds this package once (wrangler needs the assets directory), then starts `wrangler dev` on `:8787` and the Vite dev server on `:5173`, which proxies `/api` to the Worker.
The proxy keeps the browser's `Host` header, which the Worker's CSRF check matches `Origin` against on non-JSON POSTs that do not send `Sec-Fetch-Site: same-origin`; don't turn on `changeOrigin`.

## Checks

```sh
pnpm -F @mirowler/web build
pnpm turbo run typecheck --filter=@mirowler/web
```
