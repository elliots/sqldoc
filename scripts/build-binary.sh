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

OUT_DIR="${SQLDOC_BIN_DIR:-dist}"
ARGS=("$ENTRY" --out-dir "$OUT_DIR" --output-name sqldoc)

if [ $# -gt 0 ]; then
  for platform in "$@"; do
    ARGS+=(--platforms "$platform")
  done
fi

echo "Building sqldoc binary..."
"$BIN/fossilize" "${ARGS[@]}"

# Ad-hoc sign macOS binaries so they run locally without Gatekeeper killing them.
# This only works on the build machine — distributed binaries need proper
# Apple Developer ID signing or users run: xattr -d com.apple.quarantine sqldoc
if [[ "$(uname)" == "Darwin" ]]; then
  for bin in "$OUT_DIR"/sqldoc-darwin-*; do
    [ -f "$bin" ] && codesign -s - "$bin" 2>/dev/null && echo "Signed: $bin"
  done
fi
