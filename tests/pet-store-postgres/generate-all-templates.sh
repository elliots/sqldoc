#!/usr/bin/env bash
# Generate output for every template using the pet-store schema.
# Run from repo root: bash tests/pet-store-postgres/generate-all-templates.sh

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

rm -rf .sqldoc

export SQLDOC_RESOLVE_FROM_LOCAL_PACKAGE=true

TEMPLATES=$(ls ../../packages/templates/src/ | grep -vx __tests__ | grep -vx helpers | grep -vx types | grep -vx tags | grep -vx typeorm | grep -vx index.ts)

rm -rf generated-all

# Build comma-separated list and generate all at once
CSV=$(echo "$TEMPLATES" | tr '\n' ',' | sed 's/,$//')
node ../../packages/cli/src/main.ts codegen --template "$CSV" --output generated-all

echo "Done. Generated outputs in tests/pet-store-postgres/generated-all/"
