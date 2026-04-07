#!/usr/bin/env bash
set -euo pipefail

# Build all platform binaries and create a GitHub release via GoReleaser.
#
# Usage: bash scripts/release-binary.sh
#
# Requires: fossilize, goreleaser, gh (GitHub CLI)

cd "$(git rev-parse --show-toplevel)"

echo "Building binaries for all platforms..."
bash scripts/build-binary.sh linux-x64 linux-arm64 darwin-x64 darwin-arm64 win-x64

# Arrange binaries into GoReleaser's expected layout: dist/<id>_<goos>_<goarch>_v1/sqldoc
echo "Preparing dist layout for GoReleaser..."
mkdir -p dist/sqldoc_linux_amd64_v1 dist/sqldoc_linux_arm64_v1 dist/sqldoc_darwin_amd64_v1 dist/sqldoc_darwin_arm64_v1 dist/sqldoc_windows_amd64_v1
cp dist/sqldoc-linux-x64       dist/sqldoc_linux_amd64_v1/sqldoc
cp dist/sqldoc-linux-arm64     dist/sqldoc_linux_arm64_v1/sqldoc
cp dist/sqldoc-darwin-x64      dist/sqldoc_darwin_amd64_v1/sqldoc
cp dist/sqldoc-darwin-arm64    dist/sqldoc_darwin_arm64_v1/sqldoc
cp dist/sqldoc-win-x64.exe     dist/sqldoc_windows_amd64_v1/sqldoc.exe

echo "Running GoReleaser..."
goreleaser release --clean --skip=build
