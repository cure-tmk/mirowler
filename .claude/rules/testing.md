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

## apps/cli

- Plain vitest in Node, colocated with the source. Stub `fetch`; no running Worker.
- Test the CLI's own logic: the request each operation builds, argument handling, and how a non-2xx response reaches stderr and MCP tool errors. Don't re-test the Worker's API behavior.

## Running tests

- `pnpm -F @mirowler/core test`
- `pnpm -F @mirowler/worker test`
- `pnpm -F @mirowler/cli test`
- For a cross-cutting check: `pnpm test` (all, via turbo)
