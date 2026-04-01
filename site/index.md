---
layout: home
hero:
  name: sqldoc
  text: SQL tags that compile to SQL and typed code
  tagline: Annotate your SQL with tags in comments. sqldoc compiles them into correct SQL statements and typed code across PostgreSQL, MySQL, and SQLite.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/
    - theme: alt
      text: View on GitHub
      link: https://github.com/elliots/sqldoc
features:
  - title: SQL is the Source of Truth
    details: Tags live in SQL comments — your schema files remain valid SQL that any tool can read. No lock-in, no runtime dependencies.
  - title: Multi-Dialect
    details: First-class support for PostgreSQL, MySQL (beta), and SQLite (beta). One tag syntax, correct output per dialect.
  - title: Code Generation
    details: Generate typed interfaces, query builders, ORMs, and schemas in 10+ languages from your SQL — TypeScript, Go, Python, Rust, Java, and more.
  - title: Namespace Plugins
    details: Audit trails, RLS policies, validation constraints, documentation, deprecation markers — each concern is a pluggable namespace.
---

<script setup>
import { data as plugins } from './data/plugins.data'
import { data as templates } from './data/templates.data'

// Group templates by language for count
const languages = [...new Set(templates.map(t => t.language))]
</script>

<div class="home-content">

## See It in Action

Write standard SQL with tags in comments:

<SqlTransform>
<template #input>

```sql
-- @import '@sqldoc/ns-audit'
-- @import '@sqldoc/ns-validate'

-- @audit
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  -- @validate.notEmpty
  customer_name VARCHAR(100) NOT NULL,
  -- @validate.range(min: 0)
  total NUMERIC(10,2) NOT NULL
);
```

</template>
<template #output>

```sql
CREATE TABLE IF NOT EXISTS "orders_audit_log" (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  old_data JSONB,
  new_data JSONB,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_customer_name_not_empty"
  CHECK (length(trim("customer_name")) > 0);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_total_range"
  CHECK ("total" >= 0);
```

</template>
</SqlTransform>

Tags compile to correct SQL for your dialect. The original SQL stays unchanged — tags are comments.

## Namespace Plugins

<p class="section-desc">{{ plugins.length }} plugins covering audit trails, security, validation, documentation, and more.</p>

<div class="plugin-grid">
  <PluginCard
    v-for="p in plugins"
    :key="p.name"
    :name="p.name"
    :description="p.description"
    :databases="p.databases"
    :tagCount="p.tags.length"
  />
</div>

<div class="section-link">

[Browse all namespaces →](/namespaces/)

</div>

## Code Generation Templates

<p class="section-desc">{{ templates.length }} templates across {{ languages.length }} languages. Generate typed code from your SQL schema.</p>

<div class="template-grid">
  <TemplateCard
    v-for="t in templates.slice(0, 12)"
    :key="t.slug"
    :name="t.name"
    :description="t.description"
    :language="t.language"
    :slug="t.slug"
  />
</div>

<div class="section-link">

[Browse all {{ templates.length }} templates →](/templates/)

</div>

</div>

<style>
.home-content {
  max-width: 1152px;
  margin: 0 auto;
  padding: 48px 24px;
}
.home-content h2 {
  border-top: 1px solid var(--vp-c-divider);
  padding-top: 48px;
  margin-top: 48px;
}
.home-content h2:first-child {
  border-top: none;
  margin-top: 0;
}
.section-desc {
  color: var(--vp-c-text-2);
  font-size: 16px;
  margin-bottom: 24px;
}
.plugin-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  margin: 24px 0;
}
.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
  margin: 24px 0;
}
.section-link {
  text-align: center;
  margin-top: 24px;
}
.section-link a {
  color: var(--vp-c-brand-1);
  font-weight: 500;
}
</style>
