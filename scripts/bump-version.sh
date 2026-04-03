#!/usr/bin/env bash
# Bump version in all package.json files.
#
# Usage: bash scripts/bump-version.sh 0.1.0

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  CURRENT=$(bun -e "console.log(require('./package.json').version)")
  echo "Current version: ${CURRENT}"
  read -rp "New version: " VERSION
fi

[ -z "$VERSION" ] && echo "No version provided" && exit 1
VERSION="${VERSION#v}"

echo "Bumping to ${VERSION}..."

# Root
bun -e "
const fs = require('fs')
const p = JSON.parse(fs.readFileSync('package.json', 'utf-8'))
p.version = '${VERSION}'
fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n')
"

# All workspace packages (skip private)
for pkg in packages/*/package.json; do
  bun -e "
const fs = require('fs')
const p = JSON.parse(fs.readFileSync('${pkg}', 'utf-8'))
if (!p.private) { p.version = '${VERSION}' }
fs.writeFileSync('${pkg}', JSON.stringify(p, null, 2) + '\n')
"
done

echo "Done. All packages at v${VERSION}"
