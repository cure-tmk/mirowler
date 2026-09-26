#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

PROJECT_DIR="$(project_dir)"
INPUT="$(read_hook_input)"
FILE_PATH="$(extract_file_path "$INPUT")"
ABS_PATH="$(normalize_path "$PROJECT_DIR" "$FILE_PATH" || true)"

if [[ -z "${ABS_PATH:-}" || ! -f "$ABS_PATH" ]]; then
	exit 0
fi

if ! path_is_within_root "$PROJECT_DIR" "$ABS_PATH"; then
	exit 0
fi

case "$ABS_PATH" in
"$PROJECT_DIR"/apps/worker/worker-configuration.d.ts) exit 0 ;;
esac

case "$ABS_PATH" in
*.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.mts | *.cts | *.json | *.jsonc) ;;
*) exit 0 ;;
esac

BIOME="$PROJECT_DIR/node_modules/.bin/biome"
if [[ ! -x "$BIOME" ]]; then
	exit 0
fi

set +e
OUTPUT="$("$BIOME" check --write --diagnostic-level=error "$ABS_PATH" 2>&1)"
EXIT_CODE=$?
set -e

if [[ $EXIT_CODE -eq 0 ]]; then
	exit 0
fi

MESSAGE="$(printf 'Biome check failed after editing %s\n\n%s' "$FILE_PATH" "$(trim_output "$OUTPUT")")"
emit_system_message "$MESSAGE"
