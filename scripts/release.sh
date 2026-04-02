#!/usr/bin/env bash
# Release script for sqldoc
#
# Usage: bash scripts/release.sh
#
# Steps:
#   1. Prompts for new version
#   2. Updates all package.json versions
#   3. Adds changelog entry (opens $EDITOR)
#   4. Commits version bump + changelog
#   5. Tags the release
#   6. Publishes to npm (all public packages)
#   7. Pushes commits + tag to origin
#   8. Runs goreleaser for binary distribution
#
# Prerequisites:
#   - npm login (run `npm login` first)
#   - goreleaser installed (brew install goreleaser)
#   - GITHUB_TOKEN set (for goreleaser)

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# -- Colors --
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# -- Current version --
CURRENT=$(bun -e "console.log(require('./package.json').version)")
echo -e "${CYAN}Current version: ${CURRENT}${NC}"

# -- Prompt for new version --
read -rp "New version (without v prefix): " VERSION
if [[ -z "$VERSION" ]]; then
  echo -e "${RED}No version provided${NC}"
  exit 1
fi

if [[ "$VERSION" == v* ]]; then
  VERSION="${VERSION#v}"
fi

TAG="v${VERSION}"

# Check tag doesn't exist
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo -e "${RED}Tag ${TAG} already exists${NC}"
  exit 1
fi

echo ""
echo -e "${CYAN}Will release: ${TAG}${NC}"
echo ""

# -- 1. Update all package.json versions --
echo -e "${YELLOW}Updating package.json versions...${NC}"

# Root package.json
bun -e "
const fs = require('fs')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'))
pkg.version = '${VERSION}'
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')
"

# All workspace packages (except private ones keep their version)
for pkg in packages/*/package.json; do
  bun -e "
const fs = require('fs')
const pkg = JSON.parse(fs.readFileSync('${pkg}', 'utf-8'))
if (!pkg.private) {
  pkg.version = '${VERSION}'
  fs.writeFileSync('${pkg}', JSON.stringify(pkg, null, 2) + '\n')
}
"
done

echo -e "${GREEN}Updated versions to ${VERSION}${NC}"

# -- 2. Update changelog --
echo -e "${YELLOW}Preparing changelog...${NC}"

DATE=$(date +%Y-%m-%d)
CHANGES_FILE=$(mktemp)

# Get commits since last tag
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [[ -n "$LAST_TAG" ]]; then
  git log "${LAST_TAG}..HEAD" --oneline --no-merges > "$CHANGES_FILE"
else
  git log --oneline --no-merges -20 > "$CHANGES_FILE"
fi

# Build new changelog entry
NEW_ENTRY="## ${TAG} (${DATE})

$(cat "$CHANGES_FILE")
"
rm -f "$CHANGES_FILE"

if [[ -f CHANGELOG.md ]]; then
  # Prepend new entry after the title line
  EXISTING=$(cat CHANGELOG.md)
  echo -e "# Changelog\n\n${NEW_ENTRY}\n${EXISTING#*$'\n'}" > CHANGELOG.md
else
  echo -e "# Changelog\n\n${NEW_ENTRY}" > CHANGELOG.md
fi

# Open in editor for review
if [[ -n "${EDITOR:-}" ]]; then
  "$EDITOR" CHANGELOG.md
elif command -v code >/dev/null 2>&1; then
  code --wait CHANGELOG.md
else
  echo -e "${YELLOW}Edit CHANGELOG.md then press Enter to continue...${NC}"
  read -r
fi

echo -e "${GREEN}Changelog updated${NC}"

# -- 3. Commit and tag --
echo -e "${YELLOW}Committing...${NC}"
git add package.json packages/*/package.json CHANGELOG.md
git commit -m "release: ${TAG}"
git tag -a "$TAG" -m "Release ${TAG}"
echo -e "${GREEN}Tagged ${TAG}${NC}"

# -- 4. Publish to npm --
echo ""
echo -e "${CYAN}Ready to publish to npm and push to origin.${NC}"
read -rp "Continue? [y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo -e "${YELLOW}Aborted. Tag ${TAG} created locally — remove with: git tag -d ${TAG} && git reset HEAD~1${NC}"
  exit 0
fi

bash scripts/npm-publish.sh

# -- 5. Push to origin --
echo -e "${YELLOW}Pushing to origin...${NC}"
git push origin main --tags
echo -e "${GREEN}Pushed${NC}"

# -- 6. GoReleaser (binary builds + GitHub release + Homebrew) --
echo -e "${YELLOW}Running goreleaser...${NC}"
if command -v goreleaser >/dev/null 2>&1; then
  goreleaser release --clean
  echo -e "${GREEN}GoReleaser complete${NC}"
else
  echo -e "${YELLOW}goreleaser not installed — skipping binary release${NC}"
  echo "  Install: brew install goreleaser"
  echo "  Then run: goreleaser release --clean"
fi

echo ""
echo -e "${GREEN}Release ${TAG} complete!${NC}"
echo ""
echo "  npm: https://www.npmjs.com/org/sqldoc"
echo "  GitHub: https://github.com/elliots/sqldoc/releases/tag/${TAG}"
echo "  Homebrew: brew upgrade sqldoc"
