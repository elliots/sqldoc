FROM node:23-slim
WORKDIR /app
COPY . .
RUN npm init -y && npm pkg set type=module && npm install typeorm@0.3 pg reflect-metadata typescript@5 @types/pg @types/node ts-node @swc/core @swc/helpers
# Note: tsc --noEmit skipped because TypeORM's @Column type union doesn't cover
# Postgres-specific types like 'address' (composite) and 'text[]' (array).
# The runtime integration test validates entities work correctly with TypeORM.
# Run integration test against real DB
# TypeORM requires emitDecoratorMetadata which needs SWC transform (not just type stripping).
# Disable Node 23's built-in strip-types so ts-node/swc handles all .ts loading.
CMD ["node", "--no-experimental-strip-types", "--import", "data:text/javascript,import { register } from 'node:module'; import { pathToFileURL } from 'node:url'; register('ts-node/esm/transpile-only', pathToFileURL('./'));", "test.ts"]
