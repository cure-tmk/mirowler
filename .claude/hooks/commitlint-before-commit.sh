#!/usr/bin/env bash

# On `git commit` invoked via the Bash tool, run the commit message through
# commitlint to block Conventional Commits violations before the commit happens,
# and separately check for a disallowed body.
# Inputs we can't judge (message-less --amend, extraction failure, missing CLI)
# are passed through.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

PROJECT_DIR="$(project_dir)"
INPUT="$(read_hook_input)"

COMMITLINT="$PROJECT_DIR/node_modules/.bin/commitlint"
if [[ ! -x "$COMMITLINT" ]]; then
	exit 0
fi

# Extracted messages are NUL-separated; read them via a temp file instead of a
# shell variable, since bash would drop the NUL bytes.
MESSAGES_FILE="$(mktemp)"
trap 'rm -f "$MESSAGES_FILE"' EXIT

printf '%s' "$INPUT" | node "$SCRIPT_DIR/extract-commit-message.ts" "$PROJECT_DIR" >"$MESSAGES_FILE" || true

if [[ ! -s "$MESSAGES_FILE" ]]; then
	exit 0
fi

while IFS= read -r -d '' MESSAGE || [[ -n "$MESSAGE" ]]; do
	if [[ -z "$MESSAGE" ]]; then
		continue
	fi

	set +e
	OUTPUT="$(printf '%s' "$MESSAGE" | "$COMMITLINT" --cwd "$PROJECT_DIR" 2>&1)"
	EXIT_CODE=$?
	set -e

	if [[ $EXIT_CODE -ne 0 ]]; then
		# A non-zero commitlint exit doesn't distinguish lint violations from
		# runtime errors (e.g. config resolution failure). Blocking on the latter
		# would make committing impossible, so only fail when there's an actual
		# violation summary.
		if ! printf '%s' "$OUTPUT" | grep -q '✖'; then
			continue
		fi

		{
			printf 'Commit message violates commitlint.\n\n'
			trim_output "$OUTPUT"
			printf '\n\nSee .claude/rules/commit-message.md for the convention.\n'
			printf 'The list of valid types is defined by type-enum in commitlint.config.mjs.\n'
		} >&2
		exit 2
	fi

	# Body prohibition has no corresponding commitlint rule, so it's checked here.
	if printf '%s' "$MESSAGE" | node "$SCRIPT_DIR/check-commit-body.ts" "$PROJECT_DIR"; then
		{
			printf 'Commit message has a body.\n\n'
			printf 'Bodies are not allowed. Keep the subject to a single line and put background or rationale in the PR description.\n'
			printf 'If one line is not enough, split the commit instead.\n\n'
			printf 'See .claude/rules/commit-message.md for the convention.\n'
		} >&2
		exit 2
	fi
done <"$MESSAGES_FILE"

exit 0
