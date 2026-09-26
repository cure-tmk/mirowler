# Coding Styles Common

## Purpose

This rule is loaded unconditionally as the shared coding style. See `coding-styles-core.md` for `packages/core` specifics and `coding-styles-worker.md` for `apps/worker` specifics.

## Code comments

- The default is: don't write one
- The only 3 exceptions:
  1. JSDoc on a public API (the contract of an `export`ed function, type, or schema, keep it short)
  2. A non-obvious WHY that can't be read from the code (constraints, external spec, runtime/browser quirks)
  3. A note about an internal injection concern that types can't express
- Never write a restatement of WHAT the code does, information that belongs in a PR/issue, or a WHY so trivial it could be reconstructed in 30 seconds. When in doubt, delete it.

## Biome

- Formatting and most linting is Biome's job (`pnpm check` / `pnpm fix`). Don't expand manual style debates into territory Biome already automates.
- The overrides in `biome.json` (`noExplicitAny` off, `noNonNullAssertion` off, etc.) are an existing tolerance; don't tighten them in individual files.

## TypeScript

- `strict` is assumed. Write code assuming the settings in `tsconfig.base.json` (e.g. `noUncheckedIndexedAccess`).
- Express types via `zod`'s `infer` or an explicit type alias. Don't use `class` (no interface implementations backed by classes, no DI containers).
- Pass dependencies as function arguments (a port is a function type). Don't introduce constructor injection or a DI framework.

## Functions

- Keep them small. Aim for one responsibility per function; split when branching grows.
- Prefer early returns; keep nesting shallow.

## Making changes

- Prefer existing implementation patterns; don't change repo-wide style via a local edit.
- Keep changes minimal; don't mix in unrelated renames or reordering.
- New code follows the naming and export conventions of nearby files.
