---
outline: deep
---

# Connection URLs

sqldoc connects to databases for schema inspection, migration generation, and drift detection. The `devUrl` config field specifies the development database, and `sqldoc schema diff` can compare against any database URL.

## Dev database

The `devUrl` in `sqldoc.config.ts` specifies the database used for compilation and schema inspection. This is a throwaway database -- sqldoc loads your SQL files into it, inspects the result, and closes it.

```typescript
export default {
  dialect: 'postgres',
  devUrl: 'pglite', // default for postgres
}
```

## Supported URL schemes

### Built-in (zero dependencies)

These are built into sqldoc and require no additional packages.

| URL | Dialect | Description |
|-----|---------|-------------|
| `pglite` | postgres | In-memory embedded PostgreSQL via PGlite. Zero config, nothing to install. **Default for postgres.** |
| `:memory:` | sqlite | In-memory SQLite database. **Default for sqlite.** |
| `docker://postgres:16` | postgres | Spins up an ephemeral Docker container. Cleaned up automatically. |
| `docker://mysql:8` | mysql | Ephemeral Docker MySQL container. **Default for mysql.** |
| `docker://mariadb:10` | mysql | Ephemeral Docker MariaDB container. |
| `dockerfile://path/to/Dockerfile` | postgres, mysql | Build and run a custom Docker image. Useful for databases with extensions. |

### External adapters (auto-installed)

These are separate packages that sqldoc installs automatically on first use. They're installed into `.sqldoc/node_modules/` and pinned to the same version as `@sqldoc/db`.

| URL | Package | Dialect | Description |
|-----|---------|---------|-------------|
| `postgres://user:pass@host:5432/db` | `@sqldoc/db-postgres` | postgres | Connect to an external PostgreSQL database. |
| `mysql://user:pass@host:3306/db` | `@sqldoc/db-mysql` | mysql | Connect to an external MySQL database. |
| `neon://user:pass@ep-xxx.region.aws.neon.tech/db` | `@sqldoc/db-neon` | postgres | Connect to a Neon serverless PostgreSQL database. Uses `@neondatabase/serverless` for HTTP/WebSocket transport. |
| `neon-temporary` | `@sqldoc/db-neon-temporary` | postgres | Creates a temporary Neon database automatically. No URL or API key needed. Reuses the same database for 72 hours. Safe for parallel development (advisory lock). |

::: tip Bun built-in drivers
When running on Bun, `postgres://` and `mysql://` URLs use Bun's built-in SQL driver instead of the npm packages. No adapter package is installed.
:::

## Docker URLs

Docker URLs spin up a fresh container for each run. The container is removed when sqldoc finishes. This is useful for CI or when you don't want to maintain a persistent dev database.

```typescript
export default {
  dialect: 'postgres',
  devUrl: 'docker://postgres:16',
}
```

### Custom Dockerfiles

Use `dockerfile://` when your schema requires extensions or custom configuration not available in the base image:

```dockerfile
# Dockerfile.dev
FROM postgres:16
RUN apt-get update && apt-get install -y postgresql-16-postgis-3
```

```typescript
export default {
  dialect: 'postgres',
  devUrl: 'dockerfile://Dockerfile.dev',
}
```

## Neon URLs

### Read-only connection (`neon://`)

Connect to an existing Neon database for drift detection or schema comparison. This adapter uses Neon's serverless driver, which works in any environment (no TCP required).

```typescript
export default {
  dialect: 'postgres',
  devUrl: 'pglite', // dev database for compilation
}
```

Then compare against production:

```bash
sqldoc schema diff --from neon://user:pass@ep-xxx.us-east-2.aws.neon.tech/prod --to schema/
```

### Ephemeral dev database (`neon-temporary`)

Creates a temporary Neon PostgreSQL database automatically -- no URL, API key, or account needed. The database is created via [neon-new](https://github.com/neondatabase/neon-pkgs/tree/main/packages/neon-new) on first use and reused for 72 hours (cached in `.sqldoc/neon-temporary.json`).

```typescript
export default {
  dialect: 'postgres',
  devUrl: 'neon-temporary',
}
```

On each run, sqldoc:
1. Loads or creates the database (cached for 72 hours)
2. Acquires an advisory lock (blocks if another sqldoc process is using it)
3. Wipes all objects (clean slate)
4. Compiles your schema
5. Releases the lock on close

This is useful when PGlite doesn't support an extension you need, and you don't want to run Docker locally.

::: warning Credentials in URLs
For adapters that use connection URLs, don't commit database passwords to your config file. Use environment variables:

```typescript
export default {
  dialect: 'postgres',
  devUrl: process.env.DEV_DATABASE_URL,
}
```
:::

## Using URLs with `schema diff`

Both `--from` and `--to` in `sqldoc schema diff` accept database URLs:

```bash
# Compare local schema against production
sqldoc schema diff --from postgres://user:pass@prod:5432/mydb --to schema/

# Compare two databases
sqldoc schema diff --from postgres://user:pass@staging:5432/mydb --to postgres://user:pass@prod:5432/mydb

# Compare Neon production against local schema
sqldoc schema diff --from neon://user:pass@ep-xxx.neon.tech/prod --to schema/
```

## Custom adapter plugins

Any package named `@sqldoc/db-{scheme}` that exports a `DatabaseAdapterPlugin` can handle URLs with that scheme. sqldoc auto-installs them on first use.

```typescript
import type { DatabaseAdapterPlugin } from '@sqldoc/db'

const plugin: DatabaseAdapterPlugin = {
  apiVersion: 1,
  name: 'my-adapter',
  schemes: ['my-scheme'],
  dialects: ['postgres'],
  runtime: 'any',
  async createAdapter(devUrl, context) {
    // Connect and return a DatabaseAdapter
  },
}

export default plugin
```

Then use it:

```typescript
export default {
  dialect: 'postgres',
  devUrl: 'my-scheme://connection-details',
}
```
