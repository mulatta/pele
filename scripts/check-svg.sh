#!/usr/bin/env bash
# Checks that the working tree writes exactly the SVG a base commit writes: builds the base
# (default HEAD) in a temporary worktree and compares every corpus diagram byte for byte.
#   scripts/check-svg.sh [base]
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
if command -v esbuild >/dev/null 2>&1; then esbuild() { command esbuild "$@"; }; else esbuild() { nix run nixpkgs#esbuild -- "$@"; }; fi

base=$(git rev-parse "${1:-HEAD}")
tmp=$(mktemp -d)
trap 'git worktree remove --force "$tmp/base" >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
git worktree add --detach "$tmp/base" "$base" >/dev/null 2>&1
bundle() { esbuild "$1/src/index.ts" --bundle --format=esm --target=es2022 --log-level=warning --outfile="$2"; }
bundle "$tmp/base" "$tmp/before.mjs"
bundle . "$tmp/after.mjs"
node scripts/compare-svg.mjs "$tmp/before.mjs" "$tmp/after.mjs"
