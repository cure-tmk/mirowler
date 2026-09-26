# Commit Message

## Purpose

The commit message convention for this repository.

## Required

- Commit messages follow Conventional Commits
- The convention's source of truth is the root `commitlint.config.mjs`
- The list of valid types is defined by `type-enum` in `commitlint.config.mjs` (follow the config if it changes)
- No scope (`scope-empty` is `always`)
- Type is lowercase
- Subject is never empty

## Choosing a type

Choose by *intent*, not by the *result* of the change. When unsure, ask "what would happen if this change didn't exist?"

- `feat`: a user-visible feature addition (a new monitored target, notification condition, or admin UI action)
- `fix`: correcting behavior that isn't working as intended (bugs, regressions, broken build or CI)
- `refactor`: internal restructuring with no observable behavior change (moves, renames, responsibility reshuffling)
- `clean`: removing code that's no longer needed (old implementations, feature flags and their branches)
- `update`: dependency updates
- `chore`: anything else that doesn't fit above (CI config, tooling config, generated file updates)
- `docs`: developer-facing documentation only (`README`, `.claude/`)
- `revert`: reverting a past commit
- `release`: a release commit

Cases that are easy to get wrong:

- If behavior changes, it's not `refactor`; use `feat` or `fix`
- If removal is the main point, use `clean`; if removal happens as part of a move, use `refactor`
- If a dependency update is mostly a code fix, use `fix`, not `update`

## Length

- Aim for a subject under 50 characters
- Aim for the full header under 72 characters
- Both are warnings; exceeding them doesn't fail commitlint

## Style

- Subject is a noun phrase by default
- The type already conveys the kind of change, so there's no need to end with a verb like "add" or "fix"
- If a noun phrase leaves the target ambiguous, ending with a verb is fine

## No body

Commit messages are a single subject line. Bodies are prohibited, no exceptions.

- Background, root cause, and rationale all go in the PR description
- If one line isn't enough, split the commit instead of adding a body
- Use `git commit -m` exactly once; a second `-m` becomes the body

## Don't confuse this with PR titles

- PR titles are prefix-free noun phrases, a separate convention from commit messages
- Only commit messages need the type prefix

## Enforcement

- Claude Code: `.claude/hooks/commitlint-before-commit.sh` validates `git commit` before it runs and blocks violations
- There's no local git hook, so manual commits made outside Claude Code aren't caught here
