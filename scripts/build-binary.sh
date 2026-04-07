#!/usr/bin/env bash
set -euo pipefail

# Build sqldoc as a standalone Node.js SEA (Single Executable Application).
# This compiles the THIN SHIM (packages/sqldoc/) — NOT the full CLI.
# The shim handles init/add/upgrade/delegate. The actual CLI lives in
# .sqldoc/node_modules/@sqldoc/cli and is loaded at runtime.
#
# Requirements: Node.js 25+, esbuild
#
# Usage: ./scripts/build-binary.sh [GOOS] [GOARCH]
# Examples:
#   ./scripts/build-binary.sh                 # Build for current platform
#   ./scripts/build-binary.sh linux amd64     # Build for Linux AMD64
#   ./scripts/build-binary.sh darwin arm64    # Build for macOS ARM64

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN="$ROOT/node_modules/.bin"

# Accept GOOS/GOARCH parameters (optional, default to current platform)
GOOS="${1:-$(uname -s | tr '[:upper:]' '[:lower:]')}"
GOARCH="${2:-$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')}"

# Normalize Darwin to darwin
GOOS=$(echo "$GOOS" | tr '[:upper:]' '[:lower:]' | sed 's/darwin/darwin/')

ENTRY="packages/sqldoc/src/index.ts"
DIST="dist"
PLATFORM_DIR="$DIST/sqldoc_${GOOS}_${GOARCH}"
BUNDLE="$PLATFORM_DIR/sqldoc-bundle.cjs"
SEA_CONFIG="$PLATFORM_DIR/sea-config.json"
OUT="$PLATFORM_DIR/sqldoc"

# Verify Node.js version >= 25.5.0 (required for --build-sea)
NODE_VERSION=$(node -v | sed 's/^v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
NODE_MINOR=$(echo "$NODE_VERSION" | cut -d. -f2)
if [[ "$NODE_MAJOR" -lt 25 || ( "$NODE_MAJOR" -eq 25 && "$NODE_MINOR" -lt 5 ) ]]; then
  echo "Error: Node.js >= 25.5.0 required for --build-sea (found v$NODE_VERSION)" >&2
  exit 1
fi

mkdir -p "$PLATFORM_DIR"

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