<template>
  <a :href="`/namespaces/${name}`" class="plugin-card">
    <div class="plugin-card-title">@{{ name }}</div>
    <div class="plugin-card-desc">{{ description }}</div>
    <div class="plugin-card-footer">
      <span class="plugin-card-tags">{{ tagCount }} tag{{ tagCount !== 1 ? 's' : '' }}</span>
      <span class="plugin-card-dialects">
        <DialectBadge v-for="d in dialects" :key="d" :dialect="d" />
      </span>
    </div>
  </a>
</template>

<script setup lang="ts">
import DialectBadge from './DialectBadge.vue'

const props = defineProps<{
  name: string
  description: string
  databases?: string[]
  tagCount: number
}>()

const dialects = props.databases ?? ['postgres', 'mysql', 'sqlite', 'mssql']
</script>

<style>
.plugin-card {
  display: block;
  padding: 20px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
  transition: box-shadow 0.2s, border-color 0.2s;
}
.plugin-card:hover {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}
.plugin-card-title {
  font-size: 16px;
  font-weight: 600;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-brand-1);
  margin-bottom: 8px;
}
.plugin-card-desc {
  font-size: 14px;
  color: var(--vp-c-text-2);
  margin-bottom: 12px;
  line-height: 1.5;
}
.plugin-card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.plugin-card-tags {
  font-size: 12px;
  color: var(--vp-c-text-3);
}
</style>
