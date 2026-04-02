---
layout: home
hero:
  name: sqldoc
  text: SQL-first development
  tagline: A pluggable compiler pipeline for SQL schemas. Tags in comments drive code generation, migrations, and custom plugins.
  

    Your .sql files are the source of truth.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/quick-start
    - theme: alt
      text: View on GitHub
      link: https://github.com/elliots/sqldoc
features:
  - title: SQL is the Source of Truth
    details: Tags live in SQL comments — your schema files remain valid SQL that any tool can read. No lock-in, no runtime dependencies.
  - title: Multi-Dialect
    details: First-class support for PostgreSQL, with MySQL and SQLite in beta.
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

<!--@include: ./partials/homepage-example.md-->

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
.homepage-example {
  margin: 24px 0;
}
.example-block {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 0;
}
.example-block .example-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--vp-c-text-2);
  padding: 8px 16px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
}
.example-block div[class*="language-"] {
  margin: 0 !important;
  border-radius: 0 !important;
}
.example-arrow {
  text-align: center;
  font-size: 24px;
  color: var(--vp-c-text-3);
  padding: 8px 0;
}
</style>
