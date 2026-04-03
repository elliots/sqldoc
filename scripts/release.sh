#!/usr/bin/env bash
# Full release workflow. Each step can also be run individually.
#
# Steps:
#   1. bash scripts/bump-version.sh    — bump all package.json versions
#   2. bash scripts/changelog.sh       — generate changelog entry
#   3. git add + commit + tag          — commit release
#   4. bash scripts/npm-publish.sh     — publish to npm
#   5. git push --tags                 — push to origin
#   6. goreleaser release --clean      — binary builds + GitHub release + Homebrew
#
# Usage: bash scripts/release.sh

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# -- 1. Bump version --
echo -e "${CYAN}Step 1: Bump version${NC}"
bash scripts/bump-version.sh
VERSION=$(bun -e "console.log(require('./package.json').version)")
TAG="v${VERSION}"

# -- 2. Changelog --
echo -e "${CYAN}Step 2: Changelog${NC}"
bash scripts/changelog.sh

if command -v code >/dev/null 2>&1; then
  code --wait CHANGELOG.md
else
  echo -e "${YELLOW}Edit CHANGELOG.md then press Enter...${NC}"
  read -r
fi

# -- 3. Commit + tag --
echo -e "${CYAN}Step 3: Commit + tag${NC}"
git add package.json packages/*/package.json CHANGELOG.md
git commit -m "release: ${TAG}"
git tag -a "$TAG" -m "Release ${TAG}"
echo -e "${GREEN}Tagged ${TAG}${NC}"

# -- 4. Publish to npm --
echo ""
read -rp "Publish to npm and push? [y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo -e "${YELLOW}Stopped. Undo with: git tag -d ${TAG} && git reset HEAD~1${NC}"
  exit 0
fi

echo -e "${CYAN}Step 4: Publish to npm${NC}"
bash scripts/npm-publish.sh

# -- 5. Push --
echo -e "${CYAN}Step 5: Push${NC}"
git push origin main --tags
echo -e "${GREEN}Pushed${NC}"

# -- 6. GoReleaser --
echo -e "${CYAN}Step 6: GoReleaser${NC}"
if command -v goreleaser >/dev/null 2>&1; then
  goreleaser release --clean
else
  echo -e "${YELLOW}goreleaser not installed — run manually: goreleaser release --clean${NC}"
fi

echo ""
echo -e "${GREEN}Release ${TAG} complete!${NC}"
