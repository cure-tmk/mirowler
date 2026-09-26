# Writing Issues and PRs

## Purpose

Keep issues and PR descriptions at the right altitude. Implementation detail belongs in code and the diff.

## The test

If a sentence would become false after a refactor of the implementation, it does not belong in an issue or a PR description.

## Where things go

| Artifact | Write | Do not write |
| --- | --- | --- |
| Issue | What is true after merge, boundaries, verifiable done criteria, decisions already made | Steps, proposed file layout, function names, code snippets |
| PR description | What changed from the user's or operator's point of view, why this approach, how it was verified | File-by-file walkthrough, restating the diff, restating what tests do |
| PR inline comment | Why this line, when the line alone does not explain it | Anything that applies to the whole PR |
| Code | How, entirely | |

## Required

- A PR description is readable without the diff and does not duplicate it
- Write the issue before implementing and do not append implementation detail afterwards; that goes to the PR
- Decisions that outlive the PR go to `docs/` or `.claude/rules/`, and the PR links to them
- Keep "why not the alternative" when it exists; cut what and how
- Fill every template section; write "None" instead of removing a section

## Budgets

- Issue Scope: 3 lines. File names only as pointers
- Issue Notes: decisions and constraints only, no comparison of options
- PR "What does this change?": 5 lines
- PR Verification: only what was done beyond `pnpm ai:verify`

## Labels

Labels carry type, area, and waiting state. Status, milestone, size, and ordering live in the GitHub Project, never in labels.

- Every issue has exactly one `type:` label and at least one `area:` label
- PRs carry `area:` labels only
- State labels are mutually exclusive and temporary: `🙋 needs-input` (an agent sets it when blocked on the maintainer; the maintainer removes it), `⛔ blocked` (matches Depends on; removed when the dependency merges), `🤖 agent-ready` (set by the maintainer; removed when a PR opens)
- Do not add labels for priority or status, and do not create a new label unless there is a concrete filter that needs it

| Group | Labels |
| --- | --- |
| type | `🧩 type: task`, `🐛 type: bug`, `🔬 type: spike`, `📝 type: docs` |
| area | `🧠 area: core`, `☁️ area: worker`, `🖥️ area: ui`, `🔧 area: ops` |
| state | `🙋 needs-input`, `⛔ blocked`, `🤖 agent-ready` |
