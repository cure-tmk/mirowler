#!/usr/bin/env bash
set -euo pipefail

tags=$(git tag --merged HEAD --list 'v*' --sort=-v:refname)
last=${tags%%$'\n'*}
if [ -z "$last" ]; then
  echo v0.1.0
  exit 0
fi

subjects=$(git log --format=%s "$last..HEAD")
[ -n "$subjects" ] || exit 0
bodies=$(git log --format=%b "$last..HEAD")

IFS=. read -r major minor patch <<<"${last#v}"

if grep -qE '^[a-z]+!:' <<<"$subjects" || grep -q 'BREAKING CHANGE' <<<"$bodies"; then
  if [ "$major" -eq 0 ]; then
    minor=$((minor + 1)) patch=0
  else
    major=$((major + 1)) minor=0 patch=0
  fi
elif grep -qE '^feat:' <<<"$subjects"; then
  minor=$((minor + 1)) patch=0
else
  patch=$((patch + 1))
fi

echo "v$major.$minor.$patch"
