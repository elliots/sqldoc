#!/usr/bin/env bash
# Publish all public workspace packages to npm.
#
# Usage: bash scripts/npm-publish.sh

set -uo pipefail

cd "$(git rev-parse --show-toplevel)"

VERSION=$(bun -e "console.log(require('./package.json').version)")
echo "Publishing @sqldoc packages v${VERSION}"
echo ""

FAILED=0
PUBLISHED=0

for dir in packages/*/; do
  [ -f "${dir}package.json" ] || continue

  NAME=$(bun -e "const p = require('./${dir}package.json'); console.log(p.name)")
  PRIVATE=$(bun -e "const p = require('./${dir}package.json'); console.log(!!p.private)")

  if [ "$PRIVATE" = "true" ]; then
    echo "  SKIP ${NAME} (private)"
    continue
  fi

  echo "  PUBLISH ${NAME}@${VERSION}"
  if (cd "$dir" && bun publish --access public); then
    PUBLISHED=$((PUBLISHED + 1))
  else
    echo "  FAILED ${NAME}"
    FAILED=$((FAILED + 1))
  fi
  echo ""
done

echo "Published: ${PUBLISHED}, Failed: ${FAILED}"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
