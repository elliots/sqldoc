<template>
  <span class="dialect-badge" :class="dialect">
    {{ displayName }}
  </span>
</template>

<script setup lang="ts">
const props = defineProps<{ dialect: string }>()
const isBeta = props.dialect === 'mysql' || props.dialect === 'sqlite'
const displayName = isBeta
  ? `${props.dialect.charAt(0).toUpperCase() + props.dialect.slice(1)} (beta)`
  : props.dialect.charAt(0).toUpperCase() + props.dialect.slice(1)
</script>

<style>
.dialect-badge {
  display: inline-block;
  font-size: 12px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 4px;
  margin-right: 6px;
}
.dialect-badge.postgres {
  background: rgba(43, 138, 126, 0.12);
  color: var(--vp-c-brand-1);
}
.dialect-badge.mysql {
  background: rgba(59, 130, 246, 0.12);
  color: #3b82f6;
}
.dialect-badge.sqlite {
  background: rgba(139, 92, 246, 0.12);
  color: #8b5cf6;
}
</style>
