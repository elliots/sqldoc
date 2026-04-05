#!/usr/bin/env bash
set -euo pipefail

# Build sqldoc as a standalone Bun binary.
# This compiles the THIN SHIM (packages/sqldoc/) — NOT the full CLI.
# The shim handles init/add/upgrade/delegate. The actual CLI lives in
# .sqldoc/node_modules/@sqldoc/cli and is loaded at runtime.
#
# Usage: ./scripts/build-binary.sh [TARGET]
#
# Targets: bun-darwin-arm64, bun-darwin-x64, bun-linux-x64, bun-linux-arm64,
#          bun-windows-x64, bun-windows-arm64
# Default: current platform

TARGET="${1:-}"
ENTRY="packages/sqldoc/src/index.ts"
OUT="sqldoc"

CMD=(bun build "$ENTRY" --compile --minify --define COMPILED_SQLDOC=true)

if [ -n "$TARGET" ]; then
  CMD+=(--target "$TARGET")
  OUT="sqldoc-${TARGET#bun-}"
fi

CMD+=(--outfile "$OUT")

echo "Building sqldoc shim binary..."
echo "Running: ${CMD[*]}"
"${CMD[@]}"

echo ""
echo "Built: ./$OUT ($(du -h "$OUT" | cut -f1))"
echo "Test:  ./$OUT --version"
