#!/usr/bin/env bash
# Generate changelog entry from git log since last tag.
#
# Usage: bash scripts/changelog.sh

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

VERSION=$(bun -e "console.log(require('./package.json').version)")
TAG="v${VERSION}"
DATE=$(date +%Y-%m-%d)

# Commits since last tag
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -n "$LAST_TAG" ]; then
  COMMITS=$(git log "${LAST_TAG}..HEAD" --oneline --no-merges)
else
  COMMITS=$(git log --oneline --no-merges -20)
fi

NEW_ENTRY="## ${TAG} (${DATE})

${COMMITS}"

if [ -f CHANGELOG.md ]; then
  EXISTING=$(cat CHANGELOG.md)
  printf "# Changelog\n\n%s\n\n%s" "$NEW_ENTRY" "${EXISTING#*$'\n'}" > CHANGELOG.md
else
  printf "# Changelog\n\n%s\n" "$NEW_ENTRY" > CHANGELOG.md
fi

echo "Updated CHANGELOG.md for ${TAG}"
echo "Review and edit, then commit."
