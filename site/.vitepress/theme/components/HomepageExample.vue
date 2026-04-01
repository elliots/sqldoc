<script setup lang="ts">
import { ref, onMounted } from 'vue'

const props = defineProps<{
  input: string
  output: string
}>()
</script>

<template>
  <div class="homepage-example">
    <div class="example-block">
      <div class="example-label">INPUT SQL</div>
      <div class="shiki-wrapper language-sql">
        <pre class="shiki"><code>{{ props.input }}</code></pre>
      </div>
    </div>
    <div class="example-arrow">↓</div>
    <div class="example-block">
      <div class="example-label">COMPILED OUTPUT</div>
      <div class="shiki-wrapper language-sql">
        <pre class="shiki"><code>{{ props.output }}</code></pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.homepage-example {
  display: flex;
  flex-direction: column;
  margin: 24px 0;
}
.example-block {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
}
.example-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  padding: 8px 16px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
}
.shiki-wrapper pre {
  margin: 0;
  padding: 16px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.6;
  background: var(--vp-c-bg-alt);
}
.shiki-wrapper code {
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-1);
  white-space: pre;
}
.example-arrow {
  text-align: center;
  font-size: 24px;
  color: var(--vp-c-text-3);
  padding: 8px 0;
}
</style>
