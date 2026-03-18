#!/usr/bin/env bash
set -euo pipefail

CONTAINER="sqldoc-docs-test"
PORT=5434
IMAGE="registry.gitlab.com/dalibo/postgresql_anonymizer:stable"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Start postgres with anon extension
cleanup
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=test \
  -p "$PORT":5432 \
  "$IMAGE" >/dev/null

# Wait for ready
echo "Waiting for postgres..."
for i in $(seq 1 30); do
  pg_isready -h localhost -p "$PORT" -U postgres >/dev/null 2>&1 && break
  sleep 1
done

# Generate docs
echo "Generating docs..."
sqldoc codegen -c sqldoc.config.docs-docker.ts "$1"

echo "Done. Output in docs/"
