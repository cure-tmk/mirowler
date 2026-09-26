#!/usr/bin/env bash

project_dir() {
	printf '%s\n' "${CLAUDE_PROJECT_DIR:-$(pwd)}"
}

read_hook_input() {
	cat
}

# The helpers below depend on node. If it's missing from PATH, calling them inside
# an `if` silently fails (even bypassing set -e) and the hook becomes a silent no-op,
# so fail loudly here instead.
if ! command -v node >/dev/null 2>&1; then
	echo "hooks: node not found on PATH" >&2
	exit 127
fi

extract_file_path() {
	local input="$1"
	printf '%s' "$input" | node -e "const fs=require('fs'); const payload=JSON.parse(fs.readFileSync(0,'utf8')); process.stdout.write(payload?.tool_input?.file_path ?? '')"
}

normalize_path() {
	local root="$1"
	local path_value="$2"

	if [[ -z "$path_value" ]]; then
		return 1
	fi

	node -e "const path=require('path'); process.stdout.write(path.resolve(process.argv[1], process.argv[2]))" "$root" "$path_value"
}

path_is_within_root() {
	local root="$1"
	local target="$2"

	node -e "const path=require('path'); const root=path.resolve(process.argv[1]); const target=path.resolve(process.argv[2]); const rel=path.relative(root, target); const isWithin=rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); process.exit(isWithin ? 0 : 1)" "$root" "$target"
}

emit_system_message() {
	local message="$1"
	MESSAGE="$message" node -e "process.stdout.write(JSON.stringify({ systemMessage: process.env.MESSAGE ?? '' }))"
}

trim_output() {
	local output="$1"
	printf '%s' "$output" | head -n 80
}
