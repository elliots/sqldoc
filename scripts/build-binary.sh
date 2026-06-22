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
PLATFORMS=()

if [[ $# -gt 0 ]]; then
  for platform in "$@"; do
    ARGS+=(--platforms "$platform")
    PLATFORMS+=("$platform")
  done
else
  platform="$(uname | tr '[:upper:]' '[:lower:]')-$(uname -m)"
  platform="${platform/darwin/darwin}"
  platform="${platform/linux/linux}"
  platform="${platform/x86_64/x64}"
  platform="${platform/aarch64/arm64}"
  PLATFORMS+=("$platform")
fi

echo "Building sqldoc binary..."
"$BIN/fossilize" "${ARGS[@]}"

missing=()
for platform in "${PLATFORMS[@]}"; do
  ext=""
  [[ "$platform" == win* ]] && ext=".exe"
  binary="$OUT_DIR/sqldoc-$platform$ext"
  [[ -f "$binary" ]] || missing+=("$binary")
done

if [[ ${#missing[@]} -gt 0 ]]; then
  printf 'Missing expected binary: %s\n' "${missing[@]}" >&2
  exit 1
fi

# Ad-hoc sign macOS binaries so they run locally without Gatekeeper killing them.
# This only works on the build machine — distributed binaries need proper
# Apple Developer ID signing or users run: xattr -d com.apple.quarantine sqldoc
if [[ "$(uname)" == "Darwin" ]]; then
  shopt -s nullglob
  for bin in "$OUT_DIR"/sqldoc-darwin-*; do
    if codesign -s - "$bin" 2>/dev/null; then
      echo "Signed: $bin"
    fi
  done
  shopt -u nullglob
fi
