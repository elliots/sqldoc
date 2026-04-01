---
outline: deep
---

# Quick Start

Get sqldoc running in 5 minutes. This guide walks through creating a schema, adding tags, and generating typed code.

## 1. Install

::: code-group

```bash [Homebrew]
brew install elliots/sqldoc/sqldoc
```

```bash [npm]
npx @sqldoc/cli init
```

:::

## 2. Create a schema

Create a `schema.sql` file:

```sql
-- @import '@sqldoc/ns-validate'
-- @import '@sqldoc/ns-comment'

-- @comment('User accounts')
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  -- @comment('Login email address')
  -- @validate.notEmpty
  email VARCHAR(255) NOT NULL UNIQUE,
  -- @validate.length(min: 2, max: 100)
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- @comment('Blog posts')
CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id),
  -- @validate.notEmpty
  title VARCHAR(200) NOT NULL,
  body TEXT,
  published BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now()
);
```

## 3. Create a config

Create `sqldoc.config.ts`:

```typescript
export default {
  dialect: 'postgres',
  schema: ['./schema.sql'],
  codegen: [
    {
      template: 'typescript',
      output: './generated/types.ts',
    },
  ],
}
```

## 4. Validate

Check your tags are correct:

```bash
sqldoc validate
```

You should see no errors. If a tag has invalid arguments or targets the wrong SQL object, you'll get a clear error message with line numbers.

## 5. Generate code

```bash
sqldoc codegen
```

This creates `./generated/types.ts` with typed interfaces matching your schema, plus the SQL output with COMMENT ON statements and CHECK constraints compiled from your tags.

## 6. Explore more

- Add `@audit` for audit trails -- see [@audit](/namespaces/audit)
- Add `@rls` for row-level security -- see [@rls](/namespaces/rls)
- Run `sqldoc lint` to catch common issues
- Run `sqldoc schema inspect` to view the full compiled schema
- See all [namespace plugins](/namespaces/) and [templates](/templates/)

## What just happened?

sqldoc read your SQL file, parsed the tags in comments, and:

1. **Validated** that all tags have correct syntax, arguments, and targets
2. **Compiled** the tags into additional SQL (COMMENT ON statements, CHECK constraints)
3. **Generated** TypeScript interfaces from your schema via Atlas

The input SQL stayed unchanged -- tags are comments, so the file is always valid SQL.

For more on how the compiler works, see [Compilation](/guide/compilation).
