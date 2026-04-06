#!/usr/bin/env bash
set -euo pipefail

# Build sqldoc as a standalone Node.js SEA (Single Executable Application).
# This compiles the THIN SHIM (packages/sqldoc/) — NOT the full CLI.
# The shim handles init/add/upgrade/delegate. The actual CLI lives in
# .sqldoc/node_modules/@sqldoc/cli and is loaded at runtime.
#
# Requirements: Node.js 25+, esbuild
#
# Usage: ./scripts/build-binary.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN="$ROOT/node_modules/.bin"

ENTRY="packages/sqldoc/src/index.ts"
DIST="dist"
BUNDLE="$DIST/sqldoc-bundle.cjs"
SEA_CONFIG="$DIST/sea-config.json"
OUT="$DIST/sqldoc"

mkdir -p "$DIST"

# -- Stage 1: Bundle with esbuild --
# TypeScript → single CJS file with all deps (picocolors, @npmcli/arborist) inlined
echo "Bundling with esbuild..."
"$BIN/esbuild" "$ENTRY" \
  --bundle \
  --platform=node \
  --target=node25 \
  --format=cjs \
  --outfile="$BUNDLE" \
  --minify

echo "Bundle: $BUNDLE ($(du -h "$BUNDLE" | cut -f1))"

# -- Stage 2: Build SEA binary (Node 25+ --build-sea) --
cat > "$SEA_CONFIG" << EOF
{
  "main": "$BUNDLE",
  "output": "$OUT",
  "disableExperimentalSEAWarning": true,
  "useCodeCache": false,
  "useSnapshot": false
}
EOF

echo "Building SEA binary..."
node --build-sea "$SEA_CONFIG"

# Sign on macOS (required for execution on Apple Silicon)
if [[ "$(uname)" == "Darwin" ]]; then
  codesign -s - "$OUT"
fi

echo ""
echo "Built: $OUT ($(du -h "$OUT" | cut -f1))"
echo "Test:  $OUT --version"
