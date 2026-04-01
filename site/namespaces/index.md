---
outline: deep
---

# Namespace Plugins

sqldoc uses namespace plugins to transform SQL tags into additional SQL statements. Each namespace handles a specific concern -- audit trails, row-level security, validation, documentation, and more.

Tags are written as SQL comments (`-- @namespace.tag(args)`) and compiled into dialect-correct SQL at build time.

<script setup>
import { data as plugins } from '../data/plugins.data'
</script>

## Available Namespaces

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

<style>
.plugin-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  margin: 24px 0;
}
</style>

<CommunityCallout />
