<template>
  <a :href="`/templates/${slug}`" class="template-card">
    <div class="template-card-header">
      <i v-if="iconClass" :class="iconClass" class="template-card-icon"></i>
      <span v-else class="template-card-icon-fallback">{{ language.slice(0, 2).toUpperCase() }}</span>
      <span class="template-card-lang">{{ language }}</span>
    </div>
    <div class="template-card-title">{{ name }}</div>
    <div class="template-card-desc">{{ description }}</div>
  </a>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  name: string
  description: string
  language: string
  slug: string
}>()

const deviconMap: Record<string, string> = {
  typescript: 'devicon-typescript-plain colored',
  go: 'devicon-go-original-wordmark colored',
  python: 'devicon-python-plain colored',
  java: 'devicon-java-plain colored',
  kotlin: 'devicon-kotlin-plain colored',
  rust: 'devicon-rust-original',
  csharp: 'devicon-csharp-plain colored',
  php: 'devicon-php-plain colored',
  ruby: 'devicon-ruby-plain colored',
  swift: 'devicon-swift-plain colored',
  json: 'devicon-json-plain colored',
  xml: 'devicon-xml-plain colored',
  protobuf: 'devicon-protobuf-plain colored',
  sql: 'devicon-postgresql-plain colored',
}

const iconClass = computed(() => deviconMap[props.language] || null)
</script>

<style>
.template-card {
  display: block;
  padding: 16px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
  transition: box-shadow 0.2s, border-color 0.2s;
}
.template-card:hover {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}
.template-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.template-card-icon {
  font-size: 20px;
  flex-shrink: 0;
}
.template-card-icon-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  font-size: 10px;
  font-weight: 700;
  border-radius: 4px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  flex-shrink: 0;
}
.template-card-lang {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}
.template-card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin-bottom: 4px;
}
.template-card-desc {
  font-size: 13px;
  color: var(--vp-c-text-2);
  line-height: 1.4;
}
</style>
