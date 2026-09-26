# @mirowler/core

Pure domain package. It holds the decision logic of a monitor: value parsing, rule evaluation, event decision, next-run computation, and the `runCheck` pipeline that ties them together.

## Boundaries

- In scope: side-effect-free functions, types, and zod schemas. The only runtime dependency is zod.
- Out of scope: `fetch`, HTMLRewriter, D1, Hono, or anything bound to the Workers runtime. Those live in `apps/worker/src/adapters`.

## Modules

- `monitor.ts`: Monitor config, observation, and event types plus zod schemas
- `ports.ts`: function types for Fetcher / Extractor / Evaluator / Notifier
- `parse.ts`: turns extracted text into a `text` or `jpy` value
- `evaluate.ts`: deterministic `rule` / `change` evaluator
- `trigger.ts`: decides the notification event from the previous valid observation and the current one; for `change` evaluators every `matched` observation is an event
- `schedule.ts`: next run time for `interval` / `daily` schedules, including backoff after consecutive failures
- `runId.ts`: deterministic run ID from monitor ID and claim time
- `pipeline.ts`: `runCheck`, from fetch to event decision

## Contract

`monitor.ts` and `ports.ts` are the shared contract with `apps/worker`. Update the worker adapters whenever they change.

## Verify

```sh
pnpm -F @mirowler/core typecheck
pnpm -F @mirowler/core test
```
