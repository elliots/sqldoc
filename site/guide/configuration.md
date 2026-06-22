---
outline: deep
---

# Configuration

sqldoc is configured via `sqldoc.config.ts` in your project root (or `.sqldoc/` directory).

## Basic config

```typescript
export default {
  dialect: 'postgres',
  schema: ['./schema.sql'],
}
```

## Full config reference

```typescript
export default {
  // Required: SQL dialect
  dialect: 'postgres',  // 'postgres' | 'mysql' | 'sqlite'

  // Required: SQL schema files (glob patterns supported)
  schema: ['./schema.sql', './tables/*.sql'],

  // Code generation targets
  codegen: [
    {
      template: 'typescript',        // Template name or path
      output: './generated/types.ts', // Output file path
      config: {                       // Template-specific config
        dateType: 'Date',
        nullableStyle: 'optional',
      },
    },
  ],

  // Dev database URL for schema analysis
  devUrl: 'pglite',  // 'pglite' | 'docker://postgres:16' | 'postgres://...' | 'sqlite://...'

  // Namespace plugin configuration
  namespaces: {
    audit: {
      destination: 'audit_log',  // Default audit table name
    },
    lint: {
      rules: {
        'audit.require-audit': 'warn',
        'rls.require-policy': 'off',
      },
    },
  },

  // Migration settings
  migrate: {
    dir: './migrations',         // Migration output directory
    format: 'sql',               // 'sql'
  },
}
```

## Multi-project config

For monorepos or projects with multiple schemas:

```typescript
export default {
  projects: {
    main: {
      dialect: 'postgres',
      schema: ['./db/main/*.sql'],
      codegen: [{ template: 'typescript', output: './src/types/main.ts' }],
    },
    analytics: {
      dialect: 'postgres',
      schema: ['./db/analytics/*.sql'],
      codegen: [{ template: 'typescript', output: './src/types/analytics.ts' }],
    },
  },
}
```

Select a project with `--project`:

```bash
sqldoc codegen --project main
sqldoc validate --project analytics
```

## Dev database

sqldoc uses a dev database for schema analysis (Tier 2 compilation). The `devUrl` option controls which database to use:

| Value | Database | Requirements |
|-------|----------|-------------|
| `pglite` | In-memory PostgreSQL | None (default for Postgres) |
| `docker://postgres:16` | Docker PostgreSQL | Docker running |
| `postgres://user:pass@host/db` | External PostgreSQL | Connection available |
| `sqlite://./dev.db` | SQLite file | None |
| `docker://mysql:8` | Docker MySQL | Docker running |

For most development, `pglite` (the default) requires zero configuration.
