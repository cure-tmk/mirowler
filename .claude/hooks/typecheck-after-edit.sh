#!/usr/bin/env bash

# On TypeScript changes under packages/core or apps/worker, debounce and run
# the typecheck of the affected package exactly once, per package.
# Only reports back to Claude (as a systemMessage) when typecheck fails.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

PROJECT_DIR="$(project_dir)"
INPUT="$(read_hook_input)"
FILE_PATH="$(extract_file_path "$INPUT")"
ABS_PATH="$(normalize_path "$PROJECT_DIR" "$FILE_PATH" || true)"

if [[ -z "${ABS_PATH:-}" ]]; then
	exit 0
fi

if ! path_is_within_root "$PROJECT_DIR" "$ABS_PATH"; then
	exit 0
fi

case "$ABS_PATH" in
"$PROJECT_DIR"/apps/worker/worker-configuration.d.ts) exit 0 ;;
esac

PACKAGE=""
case "$ABS_PATH" in
"$PROJECT_DIR"/packages/core/tsconfig.json) PACKAGE="core" ;;
"$PROJECT_DIR"/apps/worker/tsconfig.json) PACKAGE="worker" ;;
"$PROJECT_DIR"/packages/core/*)
	case "$ABS_PATH" in
	*.ts | *.tsx) PACKAGE="core" ;;
	esac
	;;
"$PROJECT_DIR"/apps/worker/*)
	case "$ABS_PATH" in
	*.ts | *.tsx) PACKAGE="worker" ;;
	esac
	;;
esac

if [[ -z "$PACKAGE" ]]; then
	exit 0
fi

PNPM="$(command -v pnpm || true)"
if [[ -z "$PNPM" ]]; then
	exit 0
fi

STATE_DIR="$PROJECT_DIR/.claude/state"
REQUEST_FILE="$STATE_DIR/typecheck-$PACKAGE.request"
LOCK_DIR="$STATE_DIR/typecheck-$PACKAGE.lock"
LOCK_CREATED_FILE="$LOCK_DIR/created_at"
LOCK_PID_FILE="$LOCK_DIR/pid"
STALE_LOCK_GRACE_SECONDS=10
LOCK_ACQUIRE_MAX_ATTEMPTS=3
LOCK_RETRY_SLEEP_SECONDS=1

mkdir -p "$STATE_DIR"
node -e "process.stdout.write(process.hrtime.bigint().toString())" >"$REQUEST_FILE"

lock_is_stale() {
	local now created_at pid
	now="$(date +%s)"
	created_at="$(cat "$LOCK_CREATED_FILE" 2>/dev/null || true)"
	pid="$(cat "$LOCK_PID_FILE" 2>/dev/null || true)"

	if [[ -n "$pid" ]]; then
		if kill -0 "$pid" 2>/dev/null; then
			return 1
		fi
		return 0
	fi

	if [[ "$created_at" =~ ^[0-9]+$ ]] && ((now - created_at >= STALE_LOCK_GRACE_SECONDS)); then
		return 0
	fi

	return 1
}

acquire_lock() {
	local created_at attempts
	attempts=0

	while ((attempts < LOCK_ACQUIRE_MAX_ATTEMPTS)); do
		if mkdir "$LOCK_DIR" 2>/dev/null; then
			created_at="$(date +%s)"
			printf '%s\n' "$created_at" >"$LOCK_CREATED_FILE"
			printf '%s\n' "$$" >"$LOCK_PID_FILE"
			return 0
		fi

		if ! lock_is_stale; then
			return 1
		fi

		if ! rm -rf "$LOCK_DIR" 2>/dev/null; then
			return 1
		fi

		if [[ -e "$LOCK_DIR" ]]; then
			return 1
		fi

		attempts=$((attempts + 1))
		sleep "$LOCK_RETRY_SLEEP_SECONDS"
	done

	return 1
}

if ! acquire_lock; then
	exit 0
fi

cleanup() {
	rm -rf "$LOCK_DIR" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

LAST_OUTPUT=""
LAST_STATUS=0

while true; do
	while true; do
		BEFORE="$(cat "$REQUEST_FILE" 2>/dev/null || printf '0')"
		sleep 1
		AFTER="$(cat "$REQUEST_FILE" 2>/dev/null || printf '0')"
		if [[ "$BEFORE" == "$AFTER" ]]; then
			break
		fi
	done

	RUN_MARKER="$(cat "$REQUEST_FILE" 2>/dev/null || printf '0')"

	set +e
	LAST_OUTPUT="$(cd "$PROJECT_DIR" && "$PNPM" -F "@mirowler/$PACKAGE" typecheck 2>&1)"
	LAST_STATUS=$?
	set -e

	LATEST_MARKER="$(cat "$REQUEST_FILE" 2>/dev/null || printf '0')"
	if [[ "$RUN_MARKER" == "$LATEST_MARKER" ]]; then
		break
	fi
done

if [[ $LAST_STATUS -eq 0 ]]; then
	exit 0
fi

MESSAGE="$(printf 'Typecheck failed after recent edits (@mirowler/%s)\n\n%s' "$PACKAGE" "$(trim_output "$LAST_OUTPUT")")"
emit_system_message "$MESSAGE"
