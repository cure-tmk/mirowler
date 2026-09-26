# Testing

## packages/core

- Plain vitest, no runtime mocking needed.
- One test file per module by default; colocate, e.g. `monitor.ts` with `monitor.test.ts`.
- Test your own decision-making (branches, boundary values, the evaluate / trigger / schedule / parse rules). Don't test pass-through values that are already covered by a type or a zod schema.
- Unexpected input (an invalid schedule, a missing field, etc.) only needs one representative failure case; don't enumerate every combination.

## apps/worker

- Place tests under `test/` using vitest-pool-workers. Scope them to what can't be verified without the Workers runtime: D1 bindings, the `scheduled` handler invocation, etc.
- Cover, at minimum: individual adapters (HTTP status handling, CSS extraction failure paths, Slack API error responses) and that the claim's conditional UPDATE prevents double execution.
- Don't re-test logic already covered on the core side (e.g. the evaluation rules themselves).

## Running tests

- `pnpm -F @mirowler/core test`
- `pnpm -F @mirowler/worker test`
- For a cross-cutting check: `pnpm test` (both, via turbo)
