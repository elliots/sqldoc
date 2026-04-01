<template>
  <div class="sql-transform">
    <div class="sql-transform-panel">
      <div class="sql-transform-label">Input SQL</div>
      <slot name="input" />
    </div>
    <div class="sql-transform-arrow" aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M5 12h14M12 5l7 7-7 7"/>
      </svg>
    </div>
    <div class="sql-transform-panel">
      <div class="sql-transform-label">Compiled Output</div>
      <slot name="output" />
    </div>
  </div>
</template>

<style>
.sql-transform {
  display: flex;
  gap: 12px;
  align-items: stretch;
  margin: 16px 0;
}
.sql-transform-panel {
  flex: 1;
  min-width: 0;
  background: var(--vp-c-bg-soft);
  border-radius: 8px;
  padding: 4px;
}
.sql-transform-panel :deep(div[class*="language-"]) {
  margin: 0;
}
.sql-transform-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vp-c-text-2);
  padding: 8px 12px 4px;
}
.sql-transform-arrow {
  display: flex;
  align-items: center;
  color: var(--vp-c-text-3);
  flex-shrink: 0;
}
@media (max-width: 768px) {
  .sql-transform { flex-direction: column; }
  .sql-transform-arrow {
    transform: rotate(90deg);
    justify-content: center;
    padding: 4px 0;
  }
}
</style>
