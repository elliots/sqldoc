#!/usr/bin/env bash
set -euo pipefail

# Build sqldoc as standalone binaries via fossilize (Node.js SEA).
# This compiles the THIN SHIM (packages/sqldoc/) — NOT the full CLI.
# The shim handles init/add/upgrade/delegate. The actual CLI lives in
# .sqldoc/node_modules/@sqldoc/cli and is loaded at runtime via require().
#
# Usage: ./scripts/build-binary.sh [PLATFORMS...]
#
# Examples:
#   ./scripts/build-binary.sh                                    # current platform
#   ./scripts/build-binary.sh linux-x64 linux-arm64              # specific targets
#   ./scripts/build-binary.sh linux-x64 linux-arm64 darwin-x64 darwin-arm64  # all release targets

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN="$ROOT/node_modules/.bin"

ENTRY="packages/sqldoc/src/index.ts"

ARGS=("$ENTRY" --out-dir dist --output-name sqldoc)

if [ $# -gt 0 ]; then
  for platform in "$@"; do
    ARGS+=(--platforms "$platform")
  done
fi

echo "Building sqldoc binary..."
"$BIN/fossilize" "${ARGS[@]}"

# Ad-hoc sign for local macOS testing
for bin in dist/sqldoc-darwin-*; do
  [ -f "$bin" ] && codesign -s - "$bin" 2>/dev/null && echo "Signed: $bin"
done
