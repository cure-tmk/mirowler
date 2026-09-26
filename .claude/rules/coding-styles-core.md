# Coding Styles: packages/core

## Purpose

`packages/core` is the runtime-dependency-free domain layer. This distinguishes what belongs here from what doesn't.

## Purity

- The only dependency is `zod`. Don't bring in runtime-specific imports (Hono, cheerio, D1, `fetch`, etc.); it's mechanically blocked via `noRestrictedImports` in `biome.json`.
- Never call Cloudflare Workers APIs (`fetch`, `HTMLRewriter`, D1 bindings, etc.) directly from `packages/core`.
- Side effects (HTTP calls, DOM access, clock reads, randomness) are injected from outside the function. Never call them directly from inside.

## Port = function type

- Interaction with the outside world is expressed as a function type in `ports.ts` (`Fetcher`, `Extractor`, `Evaluator`, `Notifier`, etc.).
- Implementations (HTTP fetching, CSS extraction, Slack notification) live in `apps/worker/src/adapters/`. `core` only holds the types and the pipeline that calls them.
- Before adding a new fetcher / evaluator / notifier, check whether it can be done by adding a file under `adapters/` without changing the `ports.ts` type (a type change is a contract change; call it out explicitly if needed).

## Where logic goes

- Config types and validation (zod schemas): `monitor.ts`
- Evaluation, trigger decisions, schedule computation, value parsing, run id generation, and the overall pipeline: split into single-purpose files (`evaluate.ts`, `trigger.ts`, `schedule.ts`, `parse.ts`, `runId.ts`). Don't mix multiple decision-making concerns into one file.
- Don't leak `apps/worker`-specific concerns (HTTP status codes, D1 column names, the Slack API's payload shape) into core. Adapters translate to/from the port's input/output types.

## Testing

See `testing.md`. `packages/core` has no runtime dependency, so plain vitest is sufficient.
